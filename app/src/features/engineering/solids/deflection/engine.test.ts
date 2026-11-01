import '../text';
import { describe, expect, it } from 'vitest';
import { firstTexts, runTool } from '../kit/read';
import { SolidsError, type Q } from '../kit/types';
import { beamDeflection, type DeflectionInput } from './engine';
import { deflectionSpec } from './spec';

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

// The validation beam: L 4 m, E 200 GPa, I 8e-6 m^4, so EI = 1.6e6 N·m².
const [L, EI, w, P] = [4, 1.6e6, 10e3, 10e3];
const xs = [0.3, 0.9, 1.7, 2, 2.6, 3.3, 3.9];
const run = (input: Partial<DeflectionInput>) => beamDeflection({ L, EI, supports: [], loads: [], at: xs, ...input });
const matches = (r: ReturnType<typeof run>, v: (x: number) => number, tol = 1e-9) =>
  r.points.forEach((p) => rel(p.v, v(p.x), tol));

describe('beam deflection', () => {
  it('gives 5wL⁴/(384EI) for a simply supported beam, and its whole curve', () => {
    const r = run({
      supports: [
        { kind: 'pin', x: 0 },
        { kind: 'roller', x: L },
      ],
      loads: [{ kind: 'udl', x1: 0, x2: L, w1: w, w2: w }],
    });
    rel(r.vMax.v, -20.833e-3, 1e-4);
    rel(r.vMax.v, (-5 * w * L ** 4) / (384 * EI), 1e-9);
    rel(r.vMax.x, 2, 1e-9);
    matches(r, (x) => (-w * x * (L ** 3 - 2 * L * x * x + x ** 3)) / (24 * EI));
    rel(r.thetaA, (-w * L ** 3) / (24 * EI), 1e-9);
    rel(r.thetaB, (w * L ** 3) / (24 * EI), 1e-9);
    expect(r.status).toBe('determinate');
  });

  it('gives PL³/(3EI) at the tip of a cantilever', () => {
    const r = run({ supports: [{ kind: 'fixed', x: 0 }], loads: [{ kind: 'point', x: L, P }] });
    rel(r.vMax.v, -133.33e-3, 1e-4);
    rel(r.vMax.v, (-P * L ** 3) / (3 * EI), 1e-9);
    rel(r.vMax.x, L, 1e-12);
    rel(r.thetaB, (-P * L * L) / (2 * EI), 1e-9);
    matches(r, (x) => (-P * x * x * (3 * L - x)) / (6 * EI));
    rel(r.reactions[0].R, P, 1e-12);
    rel(r.reactions[0].M, P * L, 1e-12);
  });
});

describe('indeterminate beam deflection', () => {
  it('gives the propped cantilever validation case', () => {
    const r = run({
      supports: [
        { kind: 'fixed', x: 0 },
        { kind: 'roller', x: L },
      ],
      loads: [{ kind: 'udl', x1: 0, x2: L, w1: w, w2: w }],
    });
    rel(-r.vMax.v, 8.6658e-3, 1e-4);
    rel(r.vMax.x / L, 0.57846, 1e-4);
    // Independent: v = −w x²(3L² − 5Lx + 2x²)/(48EI), whose slope is zero at x = L(15 − √33)/16.
    rel(r.vMax.x, (L * (15 - Math.sqrt(33))) / 16, 1e-9);
    matches(r, (x) => (-w * x * x * (3 * L * L - 5 * L * x + 2 * x * x)) / (48 * EI));
    expect(r.status).toBe('indeterminate');
  });
});

describe('other loads on beams', () => {
  it('gives a triangular load its textbook curve', () => {
    const r = run({
      supports: [
        { kind: 'pin', x: 0 },
        { kind: 'roller', x: L },
      ],
      loads: [{ kind: 'udl', x1: 0, x2: L, w1: 0, w2: w }],
    });
    matches(r, (x) => (-w * x * (7 * L ** 4 - 10 * L * L * x * x + 3 * x ** 4)) / (360 * L * EI));
    rel(r.vMax.x / L, Math.sqrt(1 - Math.sqrt(8 / 15)), 1e-8);
  });

  it('lifts a cantilever tip by ML²/(2EI) under a counterclockwise end moment', () => {
    const M = 5e3;
    const r = run({ supports: [{ kind: 'fixed', x: 0 }], loads: [{ kind: 'moment', x: L, M }] });
    rel(r.vMax.v, (M * L * L) / (2 * EI), 1e-9);
    matches(r, (x) => (M * x * x) / (2 * EI));
  });
});

describe('continuous and hinged beams', () => {
  it('keeps two equal spans level at the middle support', () => {
    const r = beamDeflection({
      L: 8,
      EI,
      supports: [
        { kind: 'pin', x: 0 },
        { kind: 'roller', x: 4 },
        { kind: 'roller', x: 8 },
      ],
      loads: [{ kind: 'udl', x1: 0, x2: 8, w1: w, w2: w }],
      at: [4, 2],
    });
    near(r.points[0].v, 0, 1e-12);
    rel(r.reactions.find((one) => one.x === 4)?.R, 1.25 * w * 4, 1e-9);
    // Each span is a propped cantilever, mirrored, so the curves match.
    rel(r.points[1].v, (-w * 2 * 2 * (3 * 16 - 5 * 4 * 2 + 2 * 4)) / (48 * EI), 1e-9);
  });

  it('lets the slope jump at a hinge', () => {
    // A cantilever of 2 m carries half of a 20 kN load set midway along a 4 m span on a hinge and a roller.
    const r = beamDeflection({
      L: 6,
      EI,
      supports: [
        { kind: 'fixed', x: 0 },
        { kind: 'hinge', x: 2 },
        { kind: 'roller', x: 6 },
      ],
      loads: [{ kind: 'point', x: 4, P: 20e3 }],
      at: [2, 4, 6],
    });
    const vHinge = (-10e3 * 2 ** 3) / (3 * EI);
    // The beam solver's hinge reactions carry about 1e-9 of rounding, well inside the 1e-6 the tools promise.
    rel(r.points[0].v, vHinge, 1e-7);
    rel(r.points[1].v, vHinge / 2 - (20e3 * 4 ** 3) / (48 * EI), 1e-7);
    near(r.points[2].v, 0, 1e-12);
    expect(r.jumps).toHaveLength(1);
  });

  it('follows a change of EI', () => {
    const r = run({
      supports: [{ kind: 'fixed', x: 0 }],
      loads: [{ kind: 'point', x: L, P }],
      segments: [{ x1: 0, x2: 2, factor: 2 }],
    });
    rel(r.vMax.v, -P * ((L ** 3 - 2 ** 3) / (3 * 2 * EI) + 2 ** 3 / (3 * EI)), 1e-9);
  });
});

describe('odd beams', () => {
  it('scales from tiny to huge beams, and gives zero for no load', () => {
    for (const s of [1e-4, 1e4]) {
      const r = beamDeflection({
        L: L * s,
        EI: EI * s ** 4,
        supports: [{ kind: 'fixed', x: 0 }],
        loads: [{ kind: 'point', x: L * s, P }],
      });
      rel(r.vMax.v, (-P * (L * s) ** 3) / (3 * EI * s ** 4), 1e-9);
    }
    expect(run({ supports: [{ kind: 'fixed', x: 0 }] }).vMax.v).toBe(0);
  });

  it('names what is wrong', () => {
    const simple = [
      { kind: 'pin' as const, x: 0 },
      { kind: 'roller' as const, x: L },
    ];
    expect(code(() => run({ supports: [{ kind: 'roller', x: 1 }] }))).toBe('unstable');
    expect(code(() => run({ supports: [{ kind: 'hinge', x: 1 }] }))).toBe('unstable');
    expect(code(() => run({ supports: [...simple, { kind: 'roller', x: 5 }] }))).toBe('offBeam');
    expect(code(() => run({ supports: simple, loads: [{ kind: 'udl', x1: 3, x2: 1, w1: 1, w2: 1 }] }))).toBe(
      'udlOrder',
    );
    expect(code(() => run({ supports: simple, loads: [{ kind: 'point', x: -1, P }] }))).toBe('offBeam');
    expect(code(() => beamDeflection({ L, EI: 0, supports: simple, loads: [] }))).toBe('positive');
    expect(code(() => beamDeflection({ L: -1, EI, supports: simple, loads: [] }))).toBe('positive');
    expect(code(() => run({ supports: simple, segments: [{ x1: 0, x2: 1, factor: 0 }] }))).toBe('positive');
  });
});

describe('the deflection form', () => {
  const value = (r: ReturnType<typeof runTool>, id: string) =>
    r.ok ? (r.outcome.rows.find((row) => row.id === id)?.value as Q).v : NaN;

  it('reads typed lines in US units', () => {
    const r = runTool(
      deflectionSpec,
      {
        ...firstTexts(deflectionSpec),
        E: '29', // Msi
        I: '100',
        L: '10',
        supports: 'fixed 0',
        loads: 'point 10 1',
        points: '',
      },
      'us',
    );
    expect(r.ok).toBe(true);
    // PL³/(3EI) = 1 kip × (120 in)³ / (3 × 29 Msi × 100 in⁴) = 0.19862 in.
    rel(-value(r, 'vMax') / 0.0254, 1728000 / 8.7e6, 1e-9);
  });

  it('writes the moment equation of each piece', () => {
    const r = runTool(deflectionSpec, firstTexts(deflectionSpec), 'si');
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.outcome.steps.find((one) => one.key === 'deflection.moment')?.math).toContain('M(x) = 20 x - 5 x^2');
  });

  it('marks bad lines and units', () => {
    const bad = (texts: Record<string, string>) => {
      const r = runTool(deflectionSpec, { ...firstTexts(deflectionSpec), ...texts }, 'si');
      return r.ok ? 'none' : (r.error?.code ?? r.fields.map((one) => one.error.code).join());
    };
    expect(bad({ loads: 'point 2' })).toBe('loadLine');
    expect(bad({ loads: 'push 2 3' })).toBe('loadLine');
    expect(bad({ supports: 'clamp 0' })).toBe('supportLine');
    expect(bad({ supports: '' })).toBe('unstable');
    expect(bad({ segments: '0 1' })).toBe('segmentLine');
    expect(bad({ points: '1 two' })).toBe('pointLine');
    expect(bad({ E: '200 kN' })).toBe('unitMismatch');
  });
});
