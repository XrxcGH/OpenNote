import '../text';
import { describe, expect, it } from 'vitest';
import { firstTexts, runTool } from '../kit/read';
import { SolidsError } from '../kit/types';
import {
  bearingLife,
  boltedJoint,
  boltStiffness,
  cycles,
  endurance,
  fluctuating,
  lewis,
  lewisY,
  miner,
  shaftDiameter,
  spring,
} from './engine';
import { LEWIS_Y } from './data';
import { machineSpec } from './spec';

const rel = (a: number | undefined, b: number, tol: number) =>
  expect(Math.abs((a ?? NaN) - b) / Math.abs(b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const code = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    return error instanceof SolidsError ? error.code : 'other';
  }
  return 'none';
};
const MPa = 1e6;
const base = { surface: 'machined' as const, loading: 'bending' as const, reliability: 'r50' as const, kd: 1, kf: 1 };

describe('endurance limit', () => {
  it('gives the validation case', () => {
    const r = endurance({ ...base, Sut: 600 * MPa, d: 0.03 });
    rel(r.ka, 0.82788, 1e-4);
    rel(r.kb, 0.86173, 1e-4);
    rel(r.Se, 214.02 * MPa, 1e-4);
    // Independent: the same factors written out.
    rel(r.Se, 4.51 * 600 ** -0.265 * 1.24 * 30 ** -0.107 * 300 * MPa, 1e-12);
  });

  it('uses the larger size range, axial and torsion loading, reliability, and the 1400 MPa cap', () => {
    rel(endurance({ ...base, Sut: 600 * MPa, d: 0.06 }).kb, 1.51 * 60 ** -0.157, 1e-12);
    const axial = endurance({ ...base, Sut: 600 * MPa, d: 0.06, loading: 'axial' });
    expect(axial.kb).toBe(1);
    rel(axial.kc, 0.85, 1e-12);
    rel(endurance({ ...base, Sut: 600 * MPa, d: NaN, reliability: 'r99' }).ke, 0.814, 1e-3);
    rel(endurance({ ...base, Sut: 1600 * MPa, d: NaN, surface: 'ground' }).prime, 700 * MPa, 1e-12);
  });

  it('names what is wrong', () => {
    expect(code(() => endurance({ ...base, Sut: 600 * MPa, d: 0.001 }))).toBe('sizeRange');
    expect(code(() => endurance({ ...base, Sut: 0, d: NaN }))).toBe('positive');
  });
});

describe('fluctuating stress and life', () => {
  const load = { sa: 100 * MPa, sm: 150 * MPa, Se: 250 * MPa, Sut: 600 * MPa, Sy: 450 * MPa };

  it('gives the Goodman validation case and the other criteria', () => {
    const r = fluctuating(load);
    rel(r.goodman, 1.5385, 1e-4);
    // Gerber: (σm/Sut)² n² + (σa/Se) n − 1 = 0, solved by the quadratic formula.
    const [A, B] = [(150 / 600) ** 2, 100 / 250];
    rel(r.gerber, (-B + Math.sqrt(B * B + 4 * A)) / (2 * A), 1e-12);
    rel(r.elliptic, 1 / Math.hypot(100 / 250, 150 / 450), 1e-12);
    rel(r.soderberg, 1 / (100 / 250 + 150 / 450), 1e-12);
    rel(r.langer, 450 / 250, 1e-12);
  });

  it('handles fully reversed, purely mean, and compressive mean stresses', () => {
    rel(fluctuating({ ...load, sm: 0 }).gerber, 2.5, 1e-12);
    rel(fluctuating({ ...load, sa: 0 }).gerber, 4, 1e-12);
    rel(fluctuating({ ...load, sm: -100 * MPa }).goodman, 2.5, 1e-12);
  });

  it('puts the life on the S-N line through 10³ and 10⁶ cycles', () => {
    const r = cycles(300 * MPa, 600 * MPa, 250 * MPa, 0.9);
    rel(r.N, 10 ** (3 + (3 * Math.log10(540 / 300)) / Math.log10(540 / 250)), 1e-9);
    expect(cycles(200 * MPa, 600 * MPa, 250 * MPa, 0.9).N).toBe(Infinity);
    rel(
      miner([
        { n: 1e4, N: 5e4 },
        { n: 2e5, N: 1e6 },
      ]).D,
      0.4,
      1e-12,
    );
  });

  it('names what is wrong', () => {
    expect(code(() => fluctuating({ ...load, Se: 700 * MPa }))).toBe('seAboveSut');
    expect(code(() => fluctuating({ ...load, sa: 0, sm: 0 }))).toBe('noStress');
    expect(code(() => cycles(560 * MPa, 600 * MPa, 250 * MPa, 0.9))).toBe('lowCycle');
    expect(code(() => cycles(300 * MPa, 600 * MPa, 250 * MPa, 1.2))).toBe('fractionF');
    expect(code(() => miner([]))).toBe('noBlocks');
  });
});

describe('machine elements', () => {
  it('sizes a shaft so the von Mises stresses sit on the Goodman line', () => {
    const s = { Ma: 70, Mm: 0, Ta: 0, Tm: 45, Kf: 1.7, Kfs: 1.5, Se: 200 * MPa, Sut: 700 * MPa, n: 1.5 };
    const { d } = shaftDiameter(s);
    const sa = Math.hypot(
      (32 * s.Kf * s.Ma) / (Math.PI * d ** 3),
      Math.sqrt(3) * ((16 * s.Kfs * s.Ta) / (Math.PI * d ** 3)),
    );
    const sm = Math.hypot(
      (32 * s.Kf * s.Mm) / (Math.PI * d ** 3),
      Math.sqrt(3) * ((16 * s.Kfs * s.Tm) / (Math.PI * d ** 3)),
    );
    rel(sa / s.Se + sm / s.Sut, 1 / s.n, 1e-12);
  });

  it('gives the bolt validation case', () => {
    const r = boltedJoint({ At: 84.3e-6, Sp: 600 * MPa, fraction: 0.75, C: 0.2, P: 10e3 });
    rel(r.Fi, 37.935e3, 1e-6);
    rel(r.Fb, 39.935e3, 1e-6);
    expect(r.closed).toBe(true);
    rel(r.separation, 37.935e3 / 0.8, 1e-12);
  });

  it('gives the bearing and spring validation cases', () => {
    expect(bearingLife(30e3, 5e3, 'ball').L10).toBeCloseTo(216e6, 0);
    rel(bearingLife(30e3, 5e3, 'roller').L10, 6 ** (10 / 3) * 1e6, 1e-12);
    const r = spring(3e-3, 24e-3, 10, 79.3e9, 50);
    rel(r.k, 5.8081e3, 1e-4);
    rel(r.KB, 34 / 29, 1e-12);
    rel(r.tau, ((34 / 29) * 8 * 50 * 24e-3) / (Math.PI * 27e-9), 1e-12);
    rel(r.y, 50 / r.k, 1e-12);
  });

  it('gives Lewis bending with and without Barth’s factor', () => {
    rel(lewis(2e3, 0.025, 0.003, 0.322, 'none').sigma, 2e3 / (0.025 * 0.003 * 0.322), 1e-12);
    const V = Math.PI * 0.003 * 20 * 20;
    rel(lewis(2e3, 0.025, 0.003, 0.322, 'hobbed', V).Kv, (3.56 + Math.sqrt(V)) / 3.56, 1e-12);
    rel(lewis(2e3, 0.025, 0.003, 0.322, 'cut', 5).Kv, 11.1 / 6.1, 1e-12);
  });

  it('names what is wrong', () => {
    const bolt = { At: 84.3e-6, Sp: 600 * MPa, fraction: 0.75, C: 0.2, P: 10e3 };
    expect(code(() => boltedJoint({ ...bolt, C: 1 }))).toBe('jointConstant');
    expect(code(() => boltedJoint({ ...bolt, fraction: 1.2 }))).toBe('preloadFraction');
    expect(code(() => spring(3e-3, 2e-3, 10, 79.3e9))).toBe('springIndex');
    expect(code(() => bearingLife(30e3, 0, 'ball'))).toBe('positive');
    expect(code(() => shaftDiameter({ Ma: 0, Mm: 0, Ta: 0, Tm: 0, Kf: 1, Kfs: 1, Se: 1, Sut: 2, n: 1 }))).toBe(
      'noStress',
    );
  });

  it('runs every mode of the form and marks bad input', () => {
    for (const mode of ['endurance', 'fluctuating', 'life', 'miner', 'shaft', 'bolt', 'bearing', 'spring', 'gear'])
      expect(runTool(machineSpec, { ...firstTexts(machineSpec), mode }, 'us').ok, mode).toBe(true);
    const bad = (texts: Record<string, string>) => {
      const r = runTool(machineSpec, { ...firstTexts(machineSpec), ...texts }, 'si');
      return r.ok ? 'none' : (r.error?.code ?? r.fields.map((one) => one.error.code).join());
    };
    expect(bad({ mode: 'miner', blocks: '1 2 3' })).toBe('blockLine');
    expect(bad({ mode: 'gear', finish: 'cut', rpm: '' })).toBe('needSpeed');
    expect(bad({ Sut: '600 mm' })).toBe('unitMismatch');
  });
});

describe('Lewis form factor table', () => {
  it('holds the 20° full-depth values and reads between them', () => {
    // Transcribed rows of the table, checked one by one against the source.
    expect(LEWIS_Y.find(([n]) => n === 12)?.[1]).toBe(0.245);
    expect(LEWIS_Y.find(([n]) => n === 20)?.[1]).toBe(0.322);
    expect(LEWIS_Y.find(([n]) => n === 50)?.[1]).toBe(0.409);
    expect(LEWIS_Y.find(([n]) => n === 400)?.[1]).toBe(0.48);
    expect(LEWIS_Y).toHaveLength(25);
    // Y grows with the number of teeth.
    LEWIS_Y.slice(1).forEach(([, y], i) => expect(y).toBeGreaterThan(LEWIS_Y[i][1]));
    rel(lewisY(20).Y, 0.322, 1e-12);
    // 23 teeth is halfway between 22 (0.331) and 24 (0.337).
    rel(lewisY(23).Y, 0.334, 1e-12);
    // 800 teeth is halfway, in 1/N, from 400 teeth (0.480) to a rack (0.485).
    rel(lewisY(800).Y, 0.4825, 1e-12);
    expect(code(() => lewisY(10))).toBe('fewTeeth');
  });

  it('fills Y from the teeth when Y is left empty', () => {
    const r = runTool(machineSpec, { ...firstTexts(machineSpec), mode: 'gear', Y: '', teeth: '30' }, 'si');
    // sigma = Wt/(F m Y) = 2000/(0.025 x 0.003 x 0.359).
    const sigma = r.ok ? r.outcome.rows.find((row) => row.id === 'sigmaGear')?.value : undefined;
    rel((sigma as { v: number }).v, 2000 / (0.025 * 0.003 * 0.359), 1e-12);
  });
});

describe('bolt and member stiffness', () => {
  const input = { d: 0.012, At: 84.3e-6, l: 0.04, lt: 0.02, E: 200e9, Em: 200e9 };

  it('gives kb, km, and C', () => {
    const r = boltStiffness(input);
    // kb by hand: Ad = pi 12^2/4 = 113.097 mm^2; 113.097 x 84.3 x 200 000 / (113.097 x 20 + 84.3 x 20) N/mm.
    const Ad = 113.09733552923255;
    rel(r.kb / 1e3, (Ad * 84.3 * 200000) / (Ad * 20 + 84.3 * 20), 1e-12);
    // km by the general frustum formula for one 30° cone of thickness t = l/2 from a washer face D = 1.5 d,
    // k = 0.5774 pi E d / ln[(1.155 t + D - d)(D + d) / ((1.155 t + D + d)(D - d))], two in series.
    const [d, t, D] = [12, 20, 18];
    const one =
      (0.5774 * Math.PI * 200000 * d) / Math.log(((1.155 * t + D - d) * (D + d)) / ((1.155 * t + D + d) * (D - d)));
    rel(r.km / 1e3, one / 2, 1e-3);
    rel(r.C, r.kb / (r.kb + r.km), 1e-12);
    expect(code(() => boltStiffness({ ...input, lt: 0.05 }))).toBe('threadLength');
  });

  it('uses that C in the joint', () => {
    const r = runTool(machineSpec, { ...firstTexts(machineSpec), mode: 'bolt', stiffness: 'stiffnesses' }, 'si');
    expect(r.ok).toBe(true);
    const C = r.ok ? r.outcome.rows.find((row) => row.id === 'Cjoint')?.value : NaN;
    rel(C as number, boltStiffness(input).C, 1e-12);
  });
});
