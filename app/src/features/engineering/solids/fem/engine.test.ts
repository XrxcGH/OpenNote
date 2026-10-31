import { describe, expect, it } from 'vitest';
import { solveTruss as solveStatics, starterTruss } from '../../structures/truss';
import { numberLatex } from '../kit/format';
import { firstTexts, runTool } from '../kit/read';
import { SolidsError } from '../kit/types';
import { exactBar, solveHeat1D, solveHeat2D, solveModal, solvePlate } from './continuum';
import { femSpec } from './spec';
import { solveBars, solveFrame, solveTruss } from './structures';

const rel = (a: number | undefined, b: number, tol: number) =>
  expect(Math.abs((a ?? NaN) - b) / Math.abs(b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const near = (a: number | undefined, b: number, tol: number) =>
  expect(Math.abs((a ?? NaN) - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const code = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    return error instanceof SolidsError ? error.code : 'other';
  }
  return 'none';
};
const none = { Fx: 0, Fy: 0, M: 0 };

describe('line elements', () => {
  it('gives the two bars in series their validation case', () => {
    const r = solveBars(
      [0, 1, 2],
      [
        { kind: 'bar', i: 0, j: 1, E: 200e9, A: 100e-6 },
        { kind: 'bar', i: 1, j: 2, E: 200e9, A: 50e-6 },
      ],
      [{ node: 2, ...none, Fx: 10e3 }],
      [0],
    );
    rel(r.u[2], 1.5e-3, 1e-9);
    rel(r.u[1], 0.5e-3, 1e-9);
    rel(r.forces[0].sigma, 100e6, 1e-9);
    rel(r.forces[1].sigma, 200e6, 1e-9);
    rel(r.reactions.get(0), -10e3, 1e-9);
  });

  it('shares a load between springs in parallel', () => {
    const r = solveBars(
      [0, 1],
      [
        { kind: 'spring', i: 0, j: 1, k: 1e3 },
        { kind: 'spring', i: 0, j: 1, k: 3e3 },
      ],
      [{ node: 1, ...none, Fx: 100 }],
      [0],
    );
    rel(r.u[1], 100 / 4e3, 1e-12);
    rel(r.forces[1].N, 75, 1e-12);
  });

  it('gives a one-element cantilever PL³/(3EI) and PL²/(2EI) exactly', () => {
    const [E, A, I, L, P] = [200e9, 5e-3, 8e-6, 3, 10e3];
    const r = solveFrame(
      [
        { x: 0, y: 0 },
        { x: L, y: 0 },
      ],
      [{ i: 0, j: 1, E, A, I }],
      [{ node: 0, x: true, y: true, r: true }],
      [{ node: 1, Fx: 0, Fy: -P, M: 0 }],
    );
    rel(r.u[4], (-P * L ** 3) / (3 * E * I), 1e-9);
    rel(r.u[5], (-P * L ** 2) / (2 * E * I), 1e-9);
    rel(r.reactions.get(2), P * L, 1e-9);
  });
});

describe('frames and trusses', () => {
  it('balances a portal frame', () => {
    const nodes = [
      { x: 0, y: 0 },
      { x: 0, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 0 },
    ];
    const m = { E: 200e9, A: 6e-3, I: 1e-4 };
    const r = solveFrame(
      nodes,
      [
        { i: 0, j: 1, ...m },
        { i: 1, j: 2, ...m },
        { i: 2, j: 3, ...m },
      ],
      [
        { node: 0, x: true, y: true, r: true },
        { node: 3, x: true, y: true, r: false },
      ],
      [{ node: 1, Fx: 20e3, Fy: -30e3, M: 0 }],
    );
    const R = (node: number, k: number) => r.reactions.get(3 * node + k) ?? 0;
    near(R(0, 0) + R(3, 0) + 20e3, 0, 1e-6);
    near(R(0, 1) + R(3, 1) - 30e3, 0, 1e-6);
    // Moments about the origin: the fixed end's couple, the right support's force, and the load.
    near(R(0, 2) + 6 * R(3, 1) - 4 * 20e3 + 0 * -30e3, 0, 1e-5);
  });

  it('matches the truss block’s member forces', () => {
    const model = starterTruss();
    const statics = solveStatics(model);
    const nodes = model.joints.map((j) => ({ x: j.x, y: j.y }));
    const index = new Map(model.joints.map((j, n) => [j.id, n]));
    const members = model.members.map((m) => ({ i: index.get(m.a) ?? -1, j: index.get(m.b) ?? -1, E: 200e9, A: 1e-3 }));
    const r = solveTruss(
      nodes,
      members,
      [
        { node: 0, x: true, y: true, r: false },
        { node: 2, x: false, y: true, r: false },
      ],
      [{ node: 1, Fx: 0, Fy: -10, M: 0 }],
    );
    model.members.forEach((m, e) => near(r.forces[e].N, statics.forces.get(m.id) ?? NaN, 1e-9));
  });

  it('names what is wrong', () => {
    const bars = [{ kind: 'bar' as const, i: 0, j: 1, E: 1e9, A: 1e-4 }];
    expect(code(() => solveBars([0, 1], bars, [], []))).toBe('mechanism');
    expect(code(() => solveBars([0, 0], bars, [], [0]))).toBe('zeroElement');
    expect(code(() => solveBars([0, 1], [{ ...bars[0], j: 4 }], [], [0]))).toBe('nodeNumber');
    expect(code(() => solveBars([0], bars, [], [0]))).toBe('fewNodes');
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const ring = [0, 1, 2, 3].map((i) => ({ i, j: (i + 1) % 4, E: 1e9, A: 1e-4 }));
    const pinned = [
      { node: 0, x: true, y: true, r: false },
      { node: 1, x: false, y: true, r: false },
    ];
    expect(code(() => solveTruss(square, ring, pinned, [{ node: 2, ...none, Fx: 1 }]))).toBe('mechanism');
  });
});

describe('plates', () => {
  const plate = {
    W: 0.2,
    H: 0.1,
    t: 0.01,
    E: 200e9,
    nu: 0.3,
    nx: 4,
    ny: 2,
    support: 'roller' as const,
    load: 'tension' as const,
    value: 100e6,
  };

  it('passes the patch test with triangles and quadrilaterals', () => {
    for (const element of ['cst', 'q4'] as const) {
      const r = solvePlate({ ...plate, element });
      for (const s of r.stresses) {
        rel(s.s[0], 100e6, 1e-9);
        near(s.s[1], 0, 1e-3);
        near(s.s[2], 0, 1e-3);
      }
      // Independent: the right edge moves σW/E.
      rel(r.u[2 * 4], (100e6 * 0.2) / 200e9, 1e-9);
    }
  });

  it('closes on beam theory as quadrilaterals are refined, from the stiff side', () => {
    const beam = {
      W: 1,
      H: 0.1,
      t: 0.01,
      E: 200e9,
      nu: 0.3,
      support: 'clamped' as const,
      load: 'shear' as const,
      value: 1e3,
    };
    const exact = (1e3 * 1) / (3 * 200e9 * ((0.01 * 0.1 ** 3) / 12));
    const coarse = -solvePlate({ ...beam, element: 'q4', nx: 5, ny: 1 }).tip;
    const fine = -solvePlate({ ...beam, element: 'q4', nx: 40, ny: 4 }).tip;
    const triangles = -solvePlate({ ...beam, element: 'cst', nx: 40, ny: 4 }).tip;
    expect(coarse).toBeLessThan(fine);
    expect(triangles).toBeLessThan(fine);
    expect(fine / exact).toBeGreaterThan(0.9);
    expect(fine / exact).toBeLessThan(1.05);
  });

  it('names what is wrong', () => {
    expect(code(() => solvePlate({ ...plate, element: 'cst', nx: 100, ny: 10 }))).toBe('meshSize');
    expect(code(() => solvePlate({ ...plate, element: 'cst', nx: 1.5 }))).toBe('meshCount');
    expect(code(() => solvePlate({ ...plate, element: 'q4', nu: 0.5 }))).toBe('poisson');
  });
});

describe('heat and vibration', () => {
  it('gives a wall its straight-line temperatures and a source its parabola', () => {
    const els = [0, 1, 2, 3].map((i) => ({ i, j: i + 1, k: 50, A: 0.01 }));
    const xs = [0, 0.25, 0.5, 0.75, 1];
    const plain = solveHeat1D(
      xs,
      els,
      [
        { node: 0, T: 100 },
        { node: 4, T: 20 },
      ],
      [],
      0,
    );
    xs.forEach((x, n) => rel(plain.T[n], 100 - 80 * x, 1e-12));
    rel(plain.flux[0], (50 * 80) / 1, 1e-12);
    const hot = solveHeat1D(
      xs,
      els,
      [
        { node: 0, T: 0 },
        { node: 4, T: 0 },
      ],
      [],
      1e4,
    );
    // Linear elements are exact at the nodes for a uniform source: T = q̇ x (L − x)/(2k).
    xs.forEach((x, n) => near(hot.T[n], (1e4 * x * (1 - x)) / (2 * 50), 1e-9));
    expect(code(() => solveHeat1D(xs, els, [], [], 0))).toBe('noTemperature');
  });

  it('carries k t H ΔT/W across a plate', () => {
    const r = solveHeat2D({ W: 0.2, H: 0.1, t: 0.01, k: 50, nx: 4, ny: 3, T1: 100, T2: 20, source: 0 });
    rel(r.left, (50 * 0.01 * 0.1 * 80) / 0.2, 1e-9);
    r.mesh.x.forEach((x, n) => rel(r.T[n], 100 - (80 * x) / 0.2, 1e-9));
  });

  it('gives the fixed-free bar validation case and converges from above', () => {
    const input = { L: 1, E: 200e9, rho: 7850, A: 1e-4, n: 10, ends: 'fixedFree' as const };
    const r = solveModal(input);
    rel(r.found[0].omega, 7936.8, 1e-4);
    rel(exactBar(input, 1)[0], 7928.7, 1e-4);
    rel(exactBar(input, 1)[0], (Math.PI / 2) * Math.sqrt(200e9 / 7850), 1e-12);
    const conv = r.convergence.map((c) => c.omega);
    conv.slice(1).forEach((w, i) => expect(w).toBeLessThan(conv[i]));
    expect(solveModal({ ...input, ends: 'freeFree' }).found[0].omega).toBeLessThan(1e-3);
  });
});

describe('the workbench form', () => {
  it('runs every problem kind, and its examples, in both unit systems', () => {
    for (const kind of ['bar', 'truss', 'frame', 'plane', 'heat1d', 'heat2d', 'modal'])
      for (const system of ['si', 'us'] as const)
        expect(runTool(femSpec, { ...firstTexts(femSpec), kind }, system).ok, `${kind} ${system}`).toBe(true);
  });

  it('shows the assembled K and the reduced system with numbers for a small model', () => {
    // Bars of 1 m: EA/L = 200 GPa x 100 mm² = 20 000 N/mm and 200 GPa x 50 mm² = 10 000 N/mm, end 1 held, 10 kN at 3.
    const r = runTool(femSpec, firstTexts(femSpec), 'si');
    const math = (key: string) => (r.ok ? r.outcome.steps.find((one) => one.key === key)?.math : undefined);
    const n = (v: number) => numberLatex(v, 4);
    const matrix = (rows: number[][]) =>
      `\\begin{bmatrix} ${rows.map((row) => row.map(n).join(' & ')).join(' \\\\ ')} \\end{bmatrix}`;
    expect(math('fem.global')).toBe(
      `K = ${matrix([
        [20000, -20000, 0],
        [-20000, 30000, -10000],
        [0, -10000, 10000],
      ])}`,
    );
    expect(math('fem.reducedNumbers')).toBe(
      `${matrix([
        [30000, -10000],
        [-10000, 10000],
      ])} u_f = ${matrix([[0], [10000]])}`,
    );
    // A truss of 5 nodes has 10 freedoms, so it is shown too; a frame shows SI base units.
    const truss = runTool(femSpec, { ...firstTexts(femSpec), kind: 'truss' }, 'si');
    expect(truss.ok && truss.outcome.steps.some((one) => one.key === 'fem.global')).toBe(true);
    const frame = runTool(femSpec, { ...firstTexts(femSpec), kind: 'frame' }, 'si');
    expect(frame.ok && frame.outcome.steps.some((one) => one.key === 'fem.globalSi')).toBe(true);
  });

  it('reads held temperatures typed in different units as absolute temperatures', () => {
    // 212 °F is 100 °C, so a wall held at 212 °F and 20 °C runs from 373.15 K down to 293.15 K.
    const value = (r: ReturnType<typeof runTool>, id: string) => {
      const row = r.ok ? r.outcome.rows.find((one) => one.id === id) : undefined;
      return typeof row?.value === 'object' ? row.value.v : NaN;
    };
    const plate = runTool(femSpec, { ...firstTexts(femSpec), kind: 'heat2d', T1: '212 degF', T2: '20' }, 'si');
    near(value(plate, 'Tmax'), 373.15, 1e-9);
    const line = runTool(femSpec, { ...firstTexts(femSpec), kind: 'heat1d', heatTemps: '1 212\n3 68' }, 'us');
    near(value(line, 'Tmax'), 373.15, 1e-9);
    near(value(line, 'Tmin'), 293.15, 1e-9);
  });

  it('marks bad lines', () => {
    const bad = (texts: Record<string, string>) => {
      const r = runTool(femSpec, { ...firstTexts(femSpec), ...texts }, 'si');
      return r.ok ? 'none' : (r.error?.code ?? r.fields.map((one) => one.error.code).join());
    };
    expect(bad({ barElements: 'rod 1 2 200 100' })).toBe('elementLine');
    expect(bad({ barNodes: '0\nx' })).toBe('nodeLine');
    expect(bad({ kind: 'truss', trussSupports: '1 glued' })).toBe('femSupportLine');
    expect(bad({ kind: 'truss', trussLoads: '2' })).toBe('loadLine');
    expect(bad({ kind: 'frame', frameMembers: '1 2 200 5000' })).toBe('elementLine');
  });
});
