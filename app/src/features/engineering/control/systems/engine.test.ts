// System models and responses against the plan's cases and closed forms: the underdamped step response
// 1 − e^(−ζωₙt)(cos ωd t + ζ/√(1 − ζ²) sin ωd t), first-order responses, block algebra by hand, and identification
// that recovers the model the data came from.
import { describe, expect, it } from 'vitest';
import { ControlError } from '../lib/errors';
import { readTF, ssToTF, tfToSS, type TF } from '../lib/tf';
import { reduceDiagram } from './blocks';
import { respond, secondOrder, steadyState, stepAt, stepSpecs } from './engine';
import { fitFopdt, fitSecondOrder, readData } from './identify';
import { model } from './models';

const same = (a: TF, b: TF, digits = 10) => {
  expect(a.num.length).toBe(b.num.length);
  expect(a.den.length).toBe(b.den.length);
  a.num.forEach((c, i) => expect(c).toBeCloseTo(b.num[i], digits));
  a.den.forEach((c, i) => expect(c).toBeCloseTo(b.den[i], digits));
};

/** The unit step response of ωₙ²/(s² + 2ζωₙs + ωₙ²) for ζ < 1, by hand. */
const under = (z: number, wn: number) => (t: number) => {
  const wd = wn * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * wn * t) * (Math.cos(wd * t) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * t));
};

describe('validation cases', () => {
  it('4/(s² + 2s + 4): 16.303% overshoot, peak 1.16303 at 1.8138 s, 2% settling 4.038 s, rise 0.8188 s', () => {
    const s = stepSpecs(readTF('4/(s^2 + 2s + 4)'));
    expect(s.overshoot).toBeCloseTo(100 * Math.exp(-Math.PI / Math.sqrt(3)), 8);
    expect(s.overshoot).toBeCloseTo(16.303, 3);
    expect(s.tPeak).toBeCloseTo(Math.PI / Math.sqrt(3), 8);
    expect(s.peak).toBeCloseTo(1.16303, 5);
    expect(s.settling).toBeCloseTo(4.038, 3);
    expect(s.rise).toBeCloseTo(0.8188, 4);
    // Independently, the closed form crosses 0.9 at t90 and stays inside 2% after the settling time.
    const y = under(0.5, 2);
    expect(y(s.t90)).toBeCloseTo(0.9, 9);
    expect(Math.abs(y(s.settling) - 1)).toBeCloseTo(0.02, 9);
  });

  it('unity feedback of 10/(s(s + 1)) is 10/(s² + s + 10)', () => {
    same(steadyState(readTF('10/(s (s + 1))')).closed, readTF('10/(s^2 + s + 10)'));
  });

  it('10/(s(s + 1)) is type 1 with Kv = 10 and ramp error 0.1', () => {
    const r = steadyState(readTF('10/(s (s + 1))'));
    expect(r.type).toBe(1);
    expect(r.kv).toBeCloseTo(10, 12);
    expect(r.ramp).toBeCloseTo(0.1, 12);
    expect(r.step).toBe(0);
  });

  it('1/(s² + 3s + 2) to state space and back, poles −1 and −2', () => {
    const g = readTF('1/(s^2 + 3s + 2)');
    const ss = tfToSS(g);
    same(ssToTF(ss), g, 12);
    expect(ss.a).toEqual([
      [0, 1],
      [-2, -3],
    ]);
  });
});

describe('responses', () => {
  it('the exact step matches the closed form everywhere', () => {
    const ss = tfToSS(readTF('4/(s^2 + 2s + 4)'));
    for (const t of [0.1, 0.5, 1, 2.5, 7]) expect(stepAt(ss, t)).toBeCloseTo(under(0.5, 2)(t), 12);
  });

  it('first order: step 1 − e^(−t/τ), impulse e^(−t/τ)/τ, ramp t − τ(1 − e^(−t/τ))', () => {
    const g = readTF('1/(2s + 1)');
    const step = respond(g, 'step', 10);
    const imp = respond(g, 'impulse', 10);
    const ramp = respond(g, 'ramp', 10);
    for (const k of [100, 500, 1000]) {
      const t = step.t[k];
      expect(step.y[k]).toBeCloseTo(1 - Math.exp(-t / 2), 10);
      expect(imp.y[k]).toBeCloseTo(Math.exp(-t / 2) / 2, 10);
      expect(ramp.y[k]).toBeCloseTo(t - 2 * (1 - Math.exp(-t / 2)), 9);
    }
  });

  it('a sinusoid settles to |G(jω)| sin(ωt + ∠G)', () => {
    const r = respond(readTF('1/(s + 1)'), 'custom', 40, 'sin(2 t)');
    const t = r.t[1000];
    const want = Math.sin(2 * t - Math.atan(2)) / Math.sqrt(5);
    expect(r.y[1000]).toBeCloseTo(want, 3);
  });

  it('an overdamped system has no peak and the formulas know ζ', () => {
    const s = stepSpecs(readTF('2/((s + 1) (s + 2))'));
    expect(s.overshoot).toBe(0);
    expect(Number.isNaN(s.tPeak)).toBe(true);
    const f = secondOrder(readTF('2/((s + 1) (s + 2))'));
    expect(f?.zeta).toBeCloseTo(3 / (2 * Math.sqrt(2)), 12);
  });

  it('scales: a huge time constant and a tiny one give the same shape', () => {
    const slow = stepSpecs(readTF('1/(1000 s + 1)'));
    const fast = stepSpecs(readTF('1/(0.001 s + 1)'));
    expect(slow.rise).toBeCloseTo(1000 * Math.log(9), 6);
    expect(fast.rise / slow.rise).toBeCloseTo(1e-6, 12);
  });
});

describe('models and blocks', () => {
  it('mass-spring-damper, RLC, motor, thermal, and tank', () => {
    same(model('msd', { mass: 2, damping: 3, stiffness: 5 }).g, readTF('0.5/(s^2 + 1.5s + 2.5)'));
    same(model('rlc', { resistance: 10, inductance: 0.1, capacitance: 1e-3 }).g, readTF('1/(1e-4 s^2 + 0.01 s + 1)'));
    // (Js + b)(Ls + R) + K² = (0.01s + 0.1)(0.5s + 1) + 0.01 = 0.005s² + 0.06s + 0.11.
    same(
      model('motor', { inertia: 0.01, friction: 0.1, kt: 0.1, resistance: 1, inductance: 0.5 }).g,
      readTF('0.1/(0.005 s^2 + 0.06 s + 0.11)'),
    );
    same(model('thermal', { thermalR: 2, thermalC: 50 }).g, readTF('2/(100 s + 1)'));
    same(model('tank', { area: 3, flowR: 4 }).g, readTF('4/(12 s + 1)'));
  });

  it('reduces a block diagram step by step', () => {
    const r = reduceDiagram('feedback(series(10/(s + 1), 1/s), 1)');
    same(r.tf, readTF('10/(s^2 + s + 10)'));
    expect(r.steps.map((s) => s.key)).toEqual(['blocks.series', 'blocks.feedback']);
    same(reduceDiagram('parallel(1/(s + 1), 1/(s + 2))').tf, readTF('(2s + 3)/((s + 1) (s + 2))'));
    same(reduceDiagram('posfeedback(1/(s + 3), 2)').tf, readTF('1/(s + 1)'));
  });
});

describe('identification recovers the model the data came from', () => {
  it('first order plus dead time: K = 2, τ = 3, θ = 1', () => {
    const t = Array.from({ length: 4001 }, (_, k) => k * 0.01);
    const y = t.map((x) => (x > 1 ? 2 * (1 - Math.exp(-(x - 1) / 3)) : 0) + 5);
    const f = fitFopdt(readData(t.map((x, k) => `${x} ${y[k]}`).join('\n')), 1);
    expect(f.gain).toBeCloseTo(2 * (1 - Math.exp(-39 / 3)), 6);
    expect(f.params.tau).toBeCloseTo(3, 2);
    expect(f.params.theta).toBeCloseTo(1, 2);
  });

  it('second order: ζ = 0.5, ωₙ = 2 from 4/(s² + 2s + 4)', () => {
    const y = under(0.5, 2);
    const data = Array.from({ length: 1001 }, (_, k) => `${k * 0.01} ${3 * y(k * 0.01)}`).join('\n');
    const f = fitSecondOrder(readData(data), 1.5);
    expect(f.gain).toBeCloseTo(2, 4);
    expect(f.params.zeta).toBeCloseTo(0.5, 3);
    expect(f.params.wn).toBeCloseTo(2, 3);
    expect(f.rms).toBeLessThan(5e-3);
  });
});

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof ControlError) return e.code;
    throw e;
  }
  return 'none';
};

describe('impossible input', () => {
  const cases: [string, () => unknown][] = [
    ['improper', () => respond(readTF('s^2/(s + 1)'), 'step', 1)],
    ['specsUnstable', () => stepSpecs(readTF('1/(s - 1)'))],
    ['specsUnstable', () => stepSpecs(readTF('1/s'))],
    ['specsZeroFinal', () => stepSpecs(readTF('s/(s + 1)'))],
    ['impulseProper', () => respond(readTF('(s + 2)/(s + 1)'), 'impulse', 1)],
    ['inputExpr', () => respond(readTF('1/(s + 1)'), 'custom', 1, 'sin(')],
    ['spanPositive', () => respond(readTF('1/(s + 1)'), 'step', 0)],
    ['paramPositiveModel', () => model('msd', { mass: 0, damping: 1, stiffness: 1 })],
    ['paramNotNegative', () => model('msd', { mass: 1, damping: -1, stiffness: 1 })],
    ['blocksSyntax', () => reduceDiagram('series(1/(s + 1), 2')],
    ['blocksBlock', () => reduceDiagram('series(1/(s +), 2)')],
    ['blocksArgs', () => reduceDiagram('series(2)')],
    ['dataFew', () => readData('0 0\n1 1')],
    ['dataOrder', () => readData('0 0\n2 1\n1 2\n3 3\n4 4')],
    ['noOvershoot', () => fitSecondOrder(readData('0 0\n1 0.5\n2 0.8\n3 0.9\n4 1'), 1)],
    ['stepSize', () => fitFopdt(readData('0 0\n1 0.5\n2 0.8\n3 0.9\n4 1'), 0)],
  ];
  it.each(cases)('names %s', (want, f) => expect(code(f)).toBe(want));
});

describe('steady state with a cancelled pole at the origin', () => {
  it('s/(s² + s) is 1/(s + 1): type 0, Kp 1, step error 1/2, closed loop 1/(s + 2)', () => {
    for (const text of ['s/(s (s + 1))', 's/(s^2 + s)']) {
      const r = steadyState(readTF(text));
      expect(r.type).toBe(0);
      expect(r.kp).toBeCloseTo(1, 12);
      expect(r.step).toBeCloseTo(0.5, 12);
      expect(r.ramp).toBe(Infinity);
      expect(r.stable).toBe(true);
      same(r.closed, readTF('1/(s + 2)'));
      expect(r.steps[0].key).toBe('sys.cancelledHidden');
    }
  });

  it('(s + 1)/((s + 1)(s + 2)) cancels a stable pair and reports it', () => {
    const r = steadyState(readTF('(s + 1)/((s + 1) (s + 2))'));
    expect(r.kp).toBeCloseTo(0.5, 9);
    expect(r.steps[0].key).toBe('sys.cancelled');
  });
});
