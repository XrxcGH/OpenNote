import { describe, expect, it } from 'vitest';
import { firstTexts, runTool } from '../kit/read';
import { SolidsError } from '../kit/types';
import { creep, dynamic, joint, mixture, relaxation, type ModelInput } from './engine';
import { SEGMENTS } from './dempster';
import { biomechSpec } from './spec';

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
/** Fourth-order Runge–Kutta for y' = f(t, y) from 0 to t, as an independent solution of a model's equation. */
const rk4 = (f: (t: number, y: number) => number, y0: number, t: number, n = 4000) => {
  let y = y0;
  const h = t / n;
  for (let i = 0; i < n; i++) {
    const s = i * h;
    const k1 = f(s, y);
    const k2 = f(s + h / 2, y + (h * k1) / 2);
    const k3 = f(s + h / 2, y + (h * k2) / 2);
    const k4 = f(s + h, y + h * k3);
    y += (h * (k1 + 2 * k2 + 2 * k3 + k4)) / 6;
  }
  return y;
};

const MPa = 1e6;
const base = { E: 10 * MPa, eta: 100 * MPa };
const kelvin: ModelInput = { model: 'kelvin', ...base };
const maxwell: ModelInput = { model: 'maxwell', ...base };
const sls: ModelInput = { model: 'sls', ...base, Einf: 5 * MPa };

describe('creep', () => {
  it('gives the Kelvin–Voigt validation case', () => {
    rel(creep({ ...kelvin, level: 1 * MPa, ramp: 0, t: 10 }).value, 0.063212, 1e-5);
  });

  it('gives Maxwell’s steady flow and the standard linear solid’s ODE solution', () => {
    rel(creep({ ...maxwell, level: 1 * MPa, ramp: 0, t: 10 }).value, 0.1 + 0.1, 1e-12);
    // The solid's equation under a held σ0: E∞ ε + η(E∞ + E1)/E1 ε̇ = σ0, from ε = σ0/(E∞ + E1).
    const [Ei, E1, eta, s0] = [5 * MPa, 10 * MPa, 100 * MPa, 1 * MPa];
    const independent = rk4((_, e) => ((s0 - Ei * e) * E1) / (eta * (Ei + E1)), s0 / (Ei + E1), 10);
    rel(creep({ ...sls, level: s0, ramp: 0, t: 10 }).value, independent, 1e-9);
    rel(creep({ ...sls, level: s0, ramp: 0, t: 0 }).value, s0 / (Ei + E1), 1e-12);
  });

  it('adds up a ramp by Boltzmann superposition', () => {
    // η ε̇ + E ε = σ(t), with σ rising evenly to 1 MPa over 2 s and then held.
    const sigma = (t: number) => Math.min(t / 2, 1) * MPa;
    const independent = rk4((t, e) => (sigma(t) - base.E * e) / base.eta, 0, 7, 20000);
    rel(creep({ ...kelvin, level: 1 * MPa, ramp: 2, t: 7 }).value, independent, 1e-8);
    const during = rk4((t, e) => (sigma(t) - base.E * e) / base.eta, 0, 1.5, 20000);
    rel(creep({ ...kelvin, level: 1 * MPa, ramp: 2, t: 1.5 }).value, during, 1e-8);
  });
});

describe('stress relaxation', () => {
  it('gives the Maxwell validation case', () => {
    rel(relaxation({ ...maxwell, level: 0.01, ramp: 0, t: 10 }).value, 0.036788 * MPa, 1e-5);
  });

  it('agrees with the Maxwell equation under a ramp, and gives Kelvin–Voigt its dashpot', () => {
    // σ̇ + (E/η)σ = E ε̇, with ε rising evenly to 0.01 over 3 s.
    // Integrated in two pieces, so no step straddles the end of the ramp.
    const ramped = rk4((_, s) => (base.E * 0.01) / 3 - (base.E / base.eta) * s, 0, 3);
    const independent = rk4((_, s) => -(base.E / base.eta) * s, ramped, 5);
    rel(relaxation({ ...maxwell, level: 0.01, ramp: 3, t: 8 }).value, independent, 1e-6);
    rel(relaxation({ ...kelvin, level: 0.01, ramp: 2, t: 1 }).value, base.E * 0.005 + (base.eta * 0.01) / 2, 1e-12);
    rel(relaxation({ ...kelvin, level: 0.01, ramp: 0, t: 1 }).value, base.E * 0.01, 1e-12);
    expect(relaxation({ ...kelvin, level: 0.01, ramp: 0, t: 1 }).impulse).toBe(true);
    rel(relaxation({ ...sls, level: 0.01, ramp: 0, t: 1e6 }).value, 5 * MPa * 0.01, 1e-9);
  });
});

describe('cyclic loading', () => {
  it('agrees with complex arithmetic and the area of the loop', () => {
    const omega = 2 * Math.PI * 0.02;
    const r = dynamic(sls, omega, 0.01);
    // E* = E∞ + iωηE1/(E1 + iωη), written out in real and imaginary parts.
    const [a, b] = [10 * MPa, omega * 100 * MPa];
    const denominator = a * a + b * b;
    rel(r.storage, 5 * MPa + (a * b * b) / denominator, 1e-12);
    rel(r.loss, (a * a * b) / denominator, 1e-12);
    // ∮σ dε over one cycle of ε = ε0 sin ωt.
    const T = (2 * Math.PI) / omega;
    let W = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) * T) / n;
      const s = 0.01 * (r.storage * Math.sin(omega * t) + r.loss * Math.cos(omega * t));
      W += s * 0.01 * omega * Math.cos(omega * t) * (T / n);
    }
    rel(r.energy, W, 1e-6);
    rel(dynamic(kelvin, omega, 0.01).loss, 100 * MPa * omega, 1e-12);
  });
});

describe('joints and tissues', () => {
  it('gives the elbow validation case', () => {
    const r = joint({
      phi: 0,
      dm: 0.04,
      alpha: Math.PI / 2,
      loads: [
        { W: 20, d: 0.15 },
        { W: 50, d: 0.35 },
      ],
    });
    rel(r.F, 512.5, 1e-9);
    near(r.Rx, 0, 1e-9);
    rel(r.Ry, -442.5, 1e-9);
  });

  it('balances forces and moments with the segment tilted', () => {
    const input = { phi: 0.5, dm: 0.05, alpha: 1.2, loads: [{ W: 15, d: 0.2 }] };
    const r = joint(input);
    const [ux, uy] = [Math.cos(1.7), Math.sin(1.7)];
    near(r.F * ux + r.Rx, 0, 1e-9);
    near(r.F * uy + r.Ry - 15, 0, 1e-9);
    near(0.05 * Math.cos(0.5) * r.F * uy - 0.05 * Math.sin(0.5) * r.F * ux - 15 * 0.2 * Math.cos(0.5), 0, 1e-9);
  });

  it('gives the Voigt and Reuss bounds', () => {
    const r = mixture(0.4, 100e9, 1e9);
    rel(r.voigt, 40.6e9, 1e-12);
    rel(r.reuss, 1 / (0.4 / 100e9 + 0.6 / 1e9), 1e-12);
    rel(mixture(0, 100e9, 1e9).reuss, 1e9, 1e-12);
    rel(mixture(1, 100e9, 1e9).voigt, 100e9, 1e-12);
  });

  it('names what is wrong', () => {
    expect(code(() => creep({ ...kelvin, E: 0, level: 1, ramp: 0, t: 1 }))).toBe('positive');
    expect(code(() => creep({ ...sls, Einf: undefined, level: 1, ramp: 0, t: 1 }))).toBe('positive');
    expect(code(() => creep({ ...kelvin, level: 1, ramp: 0, t: -1 }))).toBe('notNegative');
    expect(code(() => joint({ phi: 0, dm: 0.04, alpha: 0, loads: [] }))).toBe('muscleLine');
    expect(code(() => mixture(1.5, 1, 1))).toBe('fraction');
    expect(code(() => dynamic(kelvin, 0, 0.01))).toBe('positive');
  });

  it('runs the form and marks a viscosity typed as a stress', () => {
    expect(runTool(biomechSpec, firstTexts(biomechSpec), 'us').ok).toBe(true);
    const r = runTool(biomechSpec, { ...firstTexts(biomechSpec), eta: '100 MPa' }, 'si');
    expect(r.ok ? 'none' : r.fields.map((one) => one.error.code).join()).toBe('unitMismatch');
  });
});

describe('Dempster body segment parameters', () => {
  it('holds the transcribed fractions', () => {
    // Mass over body mass, and center of mass from the proximal end over the segment length (Winter, Table 4.1).
    const table: Record<string, [number, number]> = {
      hand: [0.006, 0.506],
      forearm: [0.016, 0.43],
      upperArm: [0.028, 0.436],
      forearmHand: [0.022, 0.682],
      foot: [0.0145, 0.5],
      shank: [0.0465, 0.433],
      thigh: [0.1, 0.433],
      footShank: [0.061, 0.606],
      trunk: [0.497, 0.5],
      headNeck: [0.081, 1],
    };
    for (const [id, [mass, com]] of Object.entries(table))
      expect(SEGMENTS[id as keyof typeof SEGMENTS], id).toMatchObject({ mass, com });
    // The forearm and hand together weigh the forearm plus the hand.
    near(SEGMENTS.forearmHand.mass, SEGMENTS.forearm.mass + SEGMENTS.hand.mass, 1e-12);
  });

  it('fills the segment weight and distance in the joint mode', () => {
    const r = runTool(
      biomechSpec,
      { ...firstTexts(biomechSpec), mode: 'joint', segment: 'forearmHand', bodyMass: '70 kg', segLength: '300 mm' },
      'si',
    );
    expect(r.ok).toBe(true);
    // Ws = 0.022 x 70 kg x 9.80665 = 15.10224 N at 0.682 x 0.3 m = 0.2046 m; with 50 N at 0.35 m and the muscle at
    // 0.04 m, square to the forearm: Fm = (15.10224 x 0.2046 + 50 x 0.35) / 0.04.
    const F = r.ok ? r.outcome.rows.find((row) => row.id === 'muscle')?.value : undefined;
    rel((F as { v: number }).v, (0.022 * 70 * 9.80665 * 0.2046 + 50 * 0.35) / 0.04, 1e-9);
  });
});
