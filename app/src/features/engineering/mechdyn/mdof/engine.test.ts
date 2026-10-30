import { describe, expect, it } from 'vitest';
import {
  beamRoots,
  buildChain,
  solveContinuous,
  solveLumped,
  steadyAmplitudes,
  type ContinuousInput,
  type LumpedInput,
} from './engine';

const ok = <T>(out: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!out.ok) throw new Error(out.error);
  return out.value;
};
const lumped = (masses: number[], springs: number[], patch: Partial<LumpedInput> = {}): LumpedInput => {
  const { M, K, C } = buildChain({ masses, springs, dampers: springs.map(() => 0) });
  const n = masses.length;
  return {
    M,
    K,
    C,
    zeta: 0,
    x0: new Array(n).fill(0).map((_, i) => (i === 0 ? 0.01 : 0)),
    v0: new Array(n).fill(0),
    force: new Array(n).fill(0),
    omega: 0,
    duration: 0,
    ...patch,
  };
};
const beam: ContinuousInput = {
  kind: 'beam',
  ends: 'fixed-free',
  length: 1,
  tension: 0,
  massPerLength: 0,
  modulus: 200e9,
  density: 7850,
  I: 1e-8,
  A: 1e-4,
  modes: 3,
};

describe('lumped natural frequencies', () => {
  it('2-DOF chain m = 1, k = 1, wall to wall', () => {
    const r = ok(solveLumped(lumped([1, 1], [1, 1, 1])));
    expect(Math.abs(r.omegas[0] - 1)).toBeLessThan(1e-9);
    expect(Math.abs(r.omegas[1] - Math.sqrt(3))).toBeLessThan(1e-9);
    // Independent: roots of the characteristic polynomial w^4 - 4 w^2 + 3.
    expect(r.characteristic).toEqual([1, -4, 3]);
    // Mass-normalized modes: phi' M phi = 1 and in phase / out of phase.
    expect(r.modes[0][0] ** 2 + r.modes[0][1] ** 2).toBeCloseTo(1, 12);
    expect(r.shapes[0][1]).toBeCloseTo(1, 9);
    expect(r.shapes[1][1]).toBeCloseTo(-1, 9);
  });

  it('3-DOF chain fixed-free, m = k = 1', () => {
    const r = ok(solveLumped(lumped([1, 1, 1], [1, 1, 1, 0])));
    expect(Math.abs(r.omegas[0] - 0.44504)).toBeLessThan(1e-5);
    expect(Math.abs(r.omegas[1] - 1.24698)).toBeLessThan(1e-5);
    expect(Math.abs(r.omegas[2] - 1.80194)).toBeLessThan(1e-5);
    // Independent closed form for this chain: w = 2 sin((2j - 1) pi / 14).
    [1, 2, 3].forEach((j, i) => expect(r.omegas[i]).toBeCloseTo(2 * Math.sin(((2 * j - 1) * Math.PI) / 14), 10));
  });
});

describe('continuous members', () => {
  it('cantilever beam first root and frequency', () => {
    const r = ok(solveContinuous(beam));
    expect(Math.abs(r.roots[0] - 1.8751) / 1.8751).toBeLessThan(1e-5);
    // 28.246 is the exact 28.24562 rounded to three decimals, so it is held to half its last digit; the closed
    // form below holds the frequency to 1e-6.
    expect(Math.abs(r.freqs[0] - 28.246)).toBeLessThan(5e-4);
    // Independent: (1.875104069)^2 sqrt(EI / (rho A L^4)) / 2 pi.
    expect(r.freqs[0]).toBeCloseTo((1.875104069 ** 2 * Math.sqrt(2000 / 0.785)) / (2 * Math.PI), 6);
    expect(r.roots[1]).toBeCloseTo(4.694091, 5);
  });

  it('beam roots for other ends', () => {
    expect(beamRoots('pinned-pinned', 2)[1]).toBeCloseTo(2 * Math.PI, 10);
    expect(beamRoots('fixed-fixed', 1)[0]).toBeCloseTo(4.730041, 5);
    expect(beamRoots('free-free', 1)[0]).toBeCloseTo(4.730041, 5);
    expect(beamRoots('fixed-pinned', 1)[0]).toBeCloseTo(3.926602, 5);
  });

  it('strings, bars, and shafts', () => {
    const s = ok(
      solveContinuous({ ...beam, kind: 'string', ends: 'fixed-fixed', tension: 100, massPerLength: 0.01, length: 0.5 }),
    );
    expect(s.freqs[0]).toBeCloseTo(100, 9);
    const bar = ok(solveContinuous({ ...beam, kind: 'bar', ends: 'fixed-free', length: 2 }));
    expect(bar.omegas[0]).toBeCloseTo((Math.PI / 4) * Math.sqrt(200e9 / 7850), 6);
  });
});

describe('forcing and response', () => {
  it('a tuned absorber stops the main mass', () => {
    // Main mass 10 kg on 1000 N/m; absorber 1 kg on 100 N/m tuned to 10 rad/s; force 10 N on the main mass at 10 rad/s.
    const { M, K, C } = buildChain({ masses: [10, 1], springs: [1000, 100, 0], dampers: [0, 0, 0] });
    const amp = steadyAmplitudes(M, K, C, [10, 0], 10)!;
    expect(amp[0]).toBeCloseTo(0, 12);
    expect(amp[1]).toBeCloseTo(10 / 100, 12);
  });

  it('modal superposition matches the initial conditions and the steady state', () => {
    const r = ok(
      solveLumped(lumped([2, 1], [300, 200, 0], { x0: [0.01, -0.02], v0: [0.1, 0], force: [5, 0], omega: 7 })),
    );
    expect(r.response.series[0].points[0][1]).toBeCloseTo(0.01, 12);
    expect(r.response.series[1].points[0][1]).toBeCloseTo(-0.02, 12);
    expect(r.amplitudes!.length).toBe(2);
  });
});

describe('impossible input and edge cases', () => {
  it('rejects impossible input with a reason', () => {
    expect(solveLumped(lumped([1, 0], [1, 1, 1]))).toEqual({ ok: false, error: 'mdofMassDefinite' });
    expect(
      solveLumped({
        ...lumped([1, 1], [1, 1, 1]),
        K: [
          [1, 2],
          [0, 1],
        ],
      }),
    ).toEqual({ ok: false, error: 'mdofSymmetric' });
    expect(
      solveLumped({
        ...lumped([1, 1], [1, 1, 1]),
        K: [
          [-1, 0],
          [0, 1],
        ],
      }),
    ).toEqual({ ok: false, error: 'mdofUnstable' });
    expect(solveLumped(lumped([1, 1], [1, 1, 1], { force: [1, 0], omega: 1 }))).toEqual({
      ok: false,
      error: 'mdofResonance',
    });
    expect(solveLumped({ ...lumped([1], [1, 1]), M: [] })).toEqual({ ok: false, error: 'mdofEmpty' });
    expect(solveContinuous({ ...beam, length: 0 })).toEqual({ ok: false, error: 'positiveLength' });
    expect(solveContinuous({ ...beam, modes: 0 })).toEqual({ ok: false, error: 'modeCount' });
    expect(solveContinuous({ ...beam, I: -1 })).toEqual({ ok: false, error: 'positiveProperties' });
    expect(solveContinuous({ ...beam, kind: 'string', ends: 'fixed-free', tension: 1, massPerLength: 1 })).toEqual({
      ok: false,
      error: 'mdofEnds',
    });
  });

  it('free-free chains have a rigid-body mode at zero frequency', () => {
    const r = ok(solveLumped(lumped([1, 1], [0, 1, 0])));
    expect(r.omegas[0]).toBeCloseTo(0, 6);
    expect(r.omegas[1]).toBeCloseTo(Math.SQRT2, 9);
  });
});
