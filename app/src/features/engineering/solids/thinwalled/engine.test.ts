import '../text';
import { describe, expect, it } from 'vitest';
import { firstTexts, runTool } from '../kit/read';
import { SolidsError } from '../kit/types';
import { idealize, thinWalled, type Boom, type ThinLoads, type Wall } from './engine';
import { thinwalledSpec } from './spec';

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

const mm = 1e-3;
const booms = (rows: number[][]): Boom[] => rows.map(([x, y, B]) => ({ x: x * mm, y: y * mm, B: B * mm * mm }));
const walls = (rows: number[][]): Wall[] => rows.map(([i, j, t]) => ({ i: i - 1, j: j - 1, t: t * mm }));
const loads = (more: Partial<ThinLoads>): ThinLoads => ({ Sx: 0, Sy: 0, T: 0, Mx: 0, My: 0, at: 'shear', ...more });
const BOX = booms([
  [100, 50, 100],
  [-100, 50, 100],
  [-100, -50, 100],
  [100, -50, 100],
]);
const BOX_WALLS = walls([
  [1, 2, 1],
  [2, 3, 1],
  [3, 4, 1],
  [4, 1, 1],
]);

describe('closed sections under torque', () => {
  it('gives Bredt’s q = T/(2Am) in a single cell', () => {
    const r = thinWalled(
      booms([
        [0, 0, 100],
        [100, 0, 100],
        [100, 50, 100],
        [0, 50, 100],
      ]),
      walls([
        [1, 2, 2],
        [2, 3, 2],
        [3, 4, 2],
        [4, 1, 2],
      ]),
      loads({ T: 500 }),
    );
    for (const flow of r.flows.flows) rel(flow, 50e3, 1e-9);
    // Gθ′ = q ∮ds/t / (2Am), the same as 80 GPa × 0.009375 rad/m from the members tool.
    rel(r.flows.Gtheta, 80e9 * 0.009375, 1e-9);
  });

  it('gives the two-cell validation case', () => {
    const r = thinWalled(
      booms([
        [0, 0, 100],
        [200, 0, 100],
        [300, 0, 100],
        [300, 100, 100],
        [200, 100, 100],
        [0, 100, 100],
      ]),
      walls([
        [1, 2, 1],
        [2, 3, 1],
        [3, 4, 1],
        [4, 5, 1],
        [5, 6, 1],
        [6, 1, 1],
        [2, 5, 1],
      ]),
      loads({ T: 1000 }),
    );
    // Independent: equal twist gives q2 = 8q1/9, and 2A1 q1 + 2A2 q2 = T in N and mm.
    const q1 = 1e6 / (40000 + (20000 * 8) / 9);
    const q2 = (8 * q1) / 9;
    rel(q1, 17.3077, 1e-5);
    rel(r.flows.flows[0], q1 * 1e3, 1e-9);
    rel(r.flows.flows[5], q1 * 1e3, 1e-9);
    rel(r.flows.flows[2], q2 * 1e3, 1e-9);
    rel(Math.abs(r.flows.flows[6]), 1.9231e3, 1e-4);
    rel(r.flows.Gtheta, 0.221154e9, 1e-5);
    expect(r.g.cells).toHaveLength(2);
  });
});

describe('shear in boom-idealized sections', () => {
  it('gives the four-boom box 50 N/mm in each web and none in the flanges', () => {
    const r = thinWalled(BOX, BOX_WALLS, loads({ Sy: 10e3 }));
    near(r.center?.x, 0, 1e-12);
    near(r.center?.y, 0, 1e-12);
    near(r.flows.flows[0], 0, 1e-6);
    near(r.flows.flows[2], 0, 1e-6);
    rel(r.flows.flows[1], -50e3, 1e-9);
    rel(r.flows.flows[3], 50e3, 1e-9);
    near(r.flows.Gtheta, 0, 1e-3);
  });

  it('adds T/(2A) for a shear off the shear center, and gives the boom stresses', () => {
    const r = thinWalled(BOX, BOX_WALLS, loads({ Sy: 10e3, at: { x: 0.05, y: 0 }, Mx: 2e3 }));
    const extra = (10e3 * 0.05) / (2 * 0.02);
    rel(r.flows.flows[3], 50e3 + extra, 1e-9);
    rel(r.flows.flows[1], -50e3 + extra, 1e-9);
    rel(r.flows.flows[0], extra, 1e-9);
    rel(r.sigma[0], (2e3 * 0.05) / (4 * 100e-6 * 0.05 ** 2), 1e-12);
    rel(r.sigma[3], -100e6, 1e-12);
  });

  it('balances any shear on an unsymmetric box, and does not twist it through the shear center', () => {
    const b = booms([
      [120, 60, 300],
      [-80, 40, 150],
      [-80, -40, 150],
      [120, -50, 250],
      [20, 55, 80],
    ]);
    const w = walls([
      [1, 5, 1.5],
      [5, 2, 1.5],
      [2, 3, 1],
      [3, 4, 1.2],
      [4, 1, 2],
    ]);
    const r = thinWalled(b, w, loads({ Sx: 3e3, Sy: -7e3, T: 150 }));
    let [Fx, Fy, M] = [0, 0, 0];
    w.forEach((wall, e) => {
      const [p, s] = [b[wall.i], b[wall.j]];
      const f = r.flows.flows[e];
      Fx += f * (s.x - p.x);
      Fy += f * (s.y - p.y);
      M += f * (p.x * s.y - p.y * s.x);
    });
    rel(Fx, 3e3, 1e-9);
    rel(Fy, -7e3, 1e-9);
    const c = r.center ?? { x: NaN, y: NaN };
    rel(M, 150 + c.x * -7e3 - c.y * 3e3, 1e-9);
    const still = thinWalled(b, w, loads({ Sx: 3e3, Sy: -7e3 }));
    near(still.flows.Gtheta, 0, 1e-6 * Math.abs(r.flows.Gtheta));
  });

  it('puts an open channel’s shear center 20 mm behind its web', () => {
    const r = thinWalled(
      booms([
        [50, 50, 200],
        [0, 50, 300],
        [0, -50, 300],
        [50, -50, 200],
      ]),
      walls([
        [1, 2, 2],
        [2, 3, 2],
        [3, 4, 2],
      ]),
      loads({ Sy: 5e3 }),
    );
    rel(r.center?.x, -20e-3, 1e-9);
    near(r.center?.y, 0, 1e-12);
    // Hand flows: −0.004 Sy in the flanges and −0.01 Sy in the web, in N/mm for Sy in N.
    rel(r.flows.flows[0], -0.004 * 5e3 * 1e3, 1e-9);
    rel(r.flows.flows[1], -0.01 * 5e3 * 1e3, 1e-9);
    rel(r.openTorsion?.J, (200 * 2 ** 3 * 1e-12) / 3, 1e-12);
    near(r.openTorsion?.T, 0, 1e-9);
  });
});

describe('impossible sections', () => {
  it('names what is wrong', () => {
    expect(code(() => thinWalled(BOX.slice(0, 1), [], loads({})))).toBe('fewBooms');
    expect(code(() => thinWalled(BOX, [], loads({})))).toBe('noWalls');
    expect(code(() => thinWalled(BOX, walls([[1, 5, 1]]), loads({})))).toBe('wallBooms');
    expect(
      code(() =>
        thinWalled(
          BOX,
          walls([
            [1, 2, 1],
            [2, 1, 1],
          ]),
          loads({}),
        ),
      ),
    ).toBe('wallTwice');
    expect(
      code(() =>
        thinWalled(
          BOX,
          walls([
            [1, 2, 1],
            [3, 4, 1],
          ]),
          loads({}),
        ),
      ),
    ).toBe('apart');
    expect(code(() => thinWalled(BOX, walls([[1, 2, 0]]), loads({})))).toBe('positive');
    const crossed = walls([
      [1, 2, 1],
      [2, 3, 1],
      [3, 4, 1],
      [4, 1, 1],
      [1, 3, 1],
      [2, 4, 1],
    ]);
    expect(code(() => thinWalled(BOX, crossed, loads({ T: 1 })))).toBe('crossing');
    const bare = BOX.map((b) => ({ ...b, B: 0 }));
    expect(code(() => thinWalled(bare, BOX_WALLS, loads({ Sy: 1 })))).toBe('inertiaMatrix');
    expect(code(() => thinWalled(bare, BOX_WALLS, loads({ T: 1 })))).toBe('none');
  });

  it('reads the form and marks bad lines', () => {
    expect(runTool(thinwalledSpec, firstTexts(thinwalledSpec), 'us').ok).toBe(true);
    const bad = (texts: Record<string, string>) => {
      const r = runTool(thinwalledSpec, { ...firstTexts(thinwalledSpec), ...texts }, 'si');
      return r.ok ? 'none' : (r.error?.code ?? r.fields.map((one) => one.error.code).join());
    };
    expect(bad({ booms: '1 2' })).toBe('boomLine');
    expect(bad({ walls: '1 2.5 1' })).toBe('wallLine');
    expect(bad({ Sy: '10 MPa' })).toBe('unitMismatch');
  });
});

describe('boom idealization', () => {
  const mm = 1e-3;
  const box: Boom[] = [
    { x: 100 * mm, y: 50 * mm, B: 100 * mm * mm },
    { x: -100 * mm, y: 50 * mm, B: 100 * mm * mm },
    { x: -100 * mm, y: -50 * mm, B: 100 * mm * mm },
    { x: 100 * mm, y: -50 * mm, B: 100 * mm * mm },
  ];
  const skin: Wall[] = [0, 1, 2, 3].map((i) => ({ i, j: (i + 1) % 4, t: 1 * mm, tD: 1 * mm }));

  it('adds t b/6 (2 + ratio) of each effective wall to its booms', () => {
    const r = idealize(box, skin, { Sx: 0, Sy: 0, Mx: 10e3, My: 0 });
    // Covers: equal stresses at both ends, t b/2 = 100 mm²; sides: opposite stresses, t h/6 = 16.667 mm².
    for (const b of r.booms) rel(b.B / mm ** 2, 100 + 100 + 100 / 6, 1e-12);
  });

  it('gives the I of the stringers and the skin worked out directly', () => {
    const r = thinWalled(box, skin, { Sx: 0, Sy: 0, T: 0, Mx: 10e3, My: 0, at: 'shear' });
    // Stringers 4 x 100 x 50² + covers 2 x 200 x 1 x 50² + sides 2 x 1 x 100³/12, in mm⁴.
    rel(r.g.Ixx / mm ** 4, 4 * 100 * 2500 + 2 * 200 * 2500 + (2 * 100 ** 3) / 12, 1e-12);
    // The shear's own moment gives the same stress ratio, so the same areas.
    const shear = idealize(box, skin, { Sx: 0, Sy: 5e3, Mx: 0, My: 0 });
    rel(shear.booms[0].B / mm ** 2, 100 + 100 + 100 / 6, 1e-12);
  });

  it('needs a load for the ratio, and leaves walls without tD alone', () => {
    expect(code(() => idealize(box, skin, { Sx: 0, Sy: 0, Mx: 0, My: 0 }))).toBe('idealizeLoad');
    const plain = skin.map(({ i, j, t }) => ({ i, j, t }));
    expect(idealize(box, plain, { Sx: 0, Sy: 0, Mx: 1, My: 0 }).booms).toEqual(box);
  });
});
