import '../text';
import { describe, expect, it } from 'vitest';
import { cAbs, cx, solveComplex } from '../shared';
import { initialValues, runTool } from '../spec';
import {
  biquadResponse,
  design,
  difference,
  differentiator,
  exactOrder,
  instrumentation,
  integrator,
  inverting,
  loss,
  multipleFeedbackLow,
  nonInverting,
  order,
  rcCutoff,
  sallenKeyHigh,
  sallenKeyLow,
  sallenKeyStage,
  seriesRlc,
  summing,
} from './engine';
import { spec } from './tool';

const close = (a: number, b: number, rel: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.abs(b));

/**
 * |Vout/Vin| of a Sallen-Key high-pass by nodal solve. Unknowns Va (middle node) and Vb (amplifier input = output);
 * C1 from the input to a, C2 from a to b, R1 from a to the output, R2 from b to ground.
 */
function nodalSallenKeyHigh(r1: number, r2: number, c1: number, c2: number, f: number): number {
  const w = 2 * Math.PI * f;
  const a = [
    [cx(1 / r1, w * (c1 + c2)), cx(-1 / r1, -w * c2)],
    [cx(0, -w * c2), cx(1 / r2, w * c2)],
  ];
  const x = solveComplex(a, [cx(0, w * c1), cx(0)]);
  return cAbs(x![1]!);
}

/** |Vout/Vin| of a Sallen-Key low-pass found by solving the nodal equations at one frequency, with no formula for Q. */
function nodalSallenKeyLow(r1: number, r2: number, c1: number, c2: number, f: number): number {
  const w = 2 * Math.PI * f;
  // Unknowns: Va (middle node) and Vb (the non-inverting input, which is also the output). Vin = 1.
  // Node a: (Va - 1)/R1 + (Va - Vb)/R2 + jwC1 (Va - Vb) = 0. Node b: (Vb - Va)/R2 + jwC2 Vb = 0.
  const a = [
    [cx(1 / r1 + 1 / r2, w * c1), cx(-1 / r2, -w * c1)],
    [cx(-1 / r2), cx(1 / r2, w * c2)],
  ];
  const x = solveComplex(a, [cx(1 / r1), cx(0)]);
  return cAbs(x![1]!);
}

describe('amplifier gains', () => {
  it('non-inverting Rf 9k, Rg 1k has gain 10', () => {
    close(nonInverting(9000, 1000).gain, 10, 1e-9);
  });
  it('inverting 1k and 10k with 0.5 V gives -5 V', () => {
    const g = inverting(1000, 10000);
    close(g.gain * 0.5, -5, 1e-9);
    expect(g.inputResistance).toBe(1000);
  });
  it('the summer adds each input with its own gain', () => {
    const r = summing(10000, [10000, 5000, 20000], [1, 2, 4]);
    close(r.vout, -(1 + 4 + 2), 1e-12);
  });
  it('the difference amplifier gives (R2/R1)(V2 - V1) when matched, and agrees with a nodal solve when not', () => {
    const m = difference(1000, 10000, 1000, 10000, 1.0, 1.1);
    close(m.vout, 10 * 0.1, 1e-9);
    expect(m.matched).toBe(true);
    // Unmatched: the inverting node sits at the non-inverting voltage vp, so (v1 - vp)/r1 = (vp - vout)/r2.
    const [r1, r2, r3, r4, v1, v2] = [1000, 12000, 1500, 9000, 0.7, 1.3];
    const vp = (v2 * r4) / (r3 + r4);
    const vout = vp - (r2 * (v1 - vp)) / r1;
    const r = difference(r1, r2, r3, r4, v1, v2);
    close(r.vout, vout, 1e-9);
    expect(r.matched).toBe(false);
  });
  it('the instrumentation amplifier multiplies the input stage and the output stage', () => {
    const r = instrumentation(25000, 1000, 10000, 20000);
    close(r.first, 51, 1e-12);
    close(r.gain, 102, 1e-12);
  });
  it('the integrator and differentiator gains cross unity at 1/(2 pi R C)', () => {
    const i = integrator(10000, 1e-8, 159.15494);
    close(i.unity, 1591.5494, 1e-6);
    close(i.magnitude, 10, 1e-6);
    close(differentiator(10000, 1e-8, 3183.0989).magnitude, 2, 1e-6);
  });
});

describe('second-order sections', () => {
  it('unity-gain Sallen-Key low-pass: 10k, 10k, C1 22 nF feedback, C2 10 nF', () => {
    const s = sallenKeyLow(1e4, 1e4, 22e-9, 10e-9);
    close(s.f0, 1073.02, 1e-5);
    close(s.q, 0.74162, 1e-5);
    // At f0 the magnitude is Q, and far below it the gain is 1: both from the nodal solve, not from the Q formula.
    close(nodalSallenKeyLow(1e4, 1e4, 22e-9, 10e-9, s.f0), s.q, 1e-9);
    close(nodalSallenKeyLow(1e4, 1e4, 22e-9, 10e-9, 10), 1, 1e-3);
    close(biquadResponse(s, false, [s.f0])[0]!, 20 * Math.log10(s.q), 1e-9);
  });
  it('Sallen-Key high-pass and multiple-feedback low-pass', () => {
    const h = sallenKeyHigh(1e4, 2e4, 10e-9, 10e-9);
    close(h.f0, 1 / (2 * Math.PI * Math.sqrt(1e4 * 2e4 * 1e-16)), 1e-12);
    // Hand derivation: Q = sqrt(R2 C1 C2 / R1) / (C1 + C2) = 0.70711; the nodal solve gives |H(f0)| = Q independently.
    close(h.q, Math.SQRT1_2, 1e-9);
    close(nodalSallenKeyHigh(1e4, 2e4, 10e-9, 10e-9, h.f0), 0.70711, 1e-5);
    close(nodalSallenKeyHigh(1e4, 2e4, 10e-9, 10e-9, 1e6), 1, 1e-3);
    const m = multipleFeedbackLow(1e4, 1e4, 1e4, 10e-9, 1e-9);
    close(m.q, Math.sqrt(1e8 * 1e-17) / (1e-9 * 3e4), 1e-12);
    close(m.gain, -1, 1e-12);
  });
});

describe('filter order and poles', () => {
  const lp = { fp: 1000, fs: 3000, ap: 3.0103, as: 40 };
  it('Butterworth needs 5 (4.19) and Chebyshev with 1 dB ripple needs 4 (3.39)', () => {
    close(exactOrder({ ...lp, family: 'butterworth' }), 4.19, 1e-3);
    expect(order({ ...lp, family: 'butterworth' })).toBe(5);
    close(exactOrder({ ...lp, ap: 1, family: 'chebyshev' }), 3.39, 1e-3);
    expect(order({ ...lp, ap: 1, family: 'chebyshev' })).toBe(4);
  });
  it('the order meets the stop-band loss, and one order lower does not', () => {
    expect(loss('butterworth', 5, 1000, 3.0103, 3000)).toBeGreaterThan(40);
    expect(loss('butterworth', 4, 1000, 3.0103, 3000)).toBeLessThan(40);
    expect(loss('chebyshev', 4, 1000, 1, 3000)).toBeGreaterThan(40);
    expect(loss('chebyshev', 3, 1000, 1, 3000)).toBeLessThan(40);
  });
  it('Butterworth poles: third order has a real pole and a pair with Q 1', () => {
    const d = design('butterworth', 3, 1000, 3.0103);
    expect(d.sections).toHaveLength(2);
    expect(d.sections[0]!.real).toBe(true);
    close(d.sections[1]!.q, 1, 1e-3);
    close(d.sections[1]!.f0, 1000, 1e-3);
  });
  it('Butterworth fifth order Q values are 0.618 and 1.618', () => {
    const qs = design('butterworth', 5, 1000, 3.0103)
      .sections.filter((s) => !s.real)
      .map((s) => s.q);
    close(qs[0]!, 0.618034, 1e-3);
    close(qs[1]!, 1.618034, 1e-3);
  });
  it('Chebyshev 1 dB, order 4: Q values 0.7845 and 3.5604 (published normalised table)', () => {
    const qs = design('chebyshev', 4, 1000, 1).sections.map((s) => s.q);
    close(qs[0]!, 0.7845, 1e-3);
    close(qs[1]!, 3.5604, 1e-3);
  });
  it('the product of the sections reproduces the Butterworth magnitude formula', () => {
    const d = design('butterworth', 5, 1000, 3.0103);
    const f = 2200;
    let db = 0;
    for (const s of d.sections) {
      db += s.real
        ? -10 * Math.log10(1 + (f / s.f0) ** 2)
        : biquadResponse({ f0: s.f0, q: s.q, gain: 1 }, false, [f])[0]!;
    }
    close(-db, loss('butterworth', 5, 1000, 3.0103, f), 1e-6);
  });
  it('refuses a stop band that is not above the passband, or a loss that is not bigger', () => {
    expect(() => exactOrder({ ...lp, fs: 900, family: 'butterworth' })).toThrow();
    expect(() => exactOrder({ ...lp, as: 2, family: 'butterworth' })).toThrow();
    expect(() => exactOrder({ ...lp, ap: 0, family: 'butterworth' })).toThrow();
  });
  it('the Sallen-Key stage values reproduce f0 and Q', () => {
    const c = sallenKeyStage(1000, 0.7071, 10e-9);
    const s = sallenKeyLow(c.r, c.r, c.c1, c.c2);
    close(s.f0, 1000, 1e-9);
    close(s.q, 0.7071, 1e-9);
  });
});

describe('passive filters', () => {
  it('RC cutoff and series RLC resonance', () => {
    close(rcCutoff(1000, 1e-6), 159.155, 1e-5);
    const r = seriesRlc(10, 0.01, 10e-6);
    close(r.f0, 503.29, 1e-5);
    close(r.q, 3.1623, 1e-4);
    close(r.bandwidth, r.f0 / r.q, 1e-12);
  });
});

describe('the op-amp tool form', () => {
  it('answers every configuration and names a bad number', () => {
    const values = initialValues(spec);
    for (const config of [
      'inverting',
      'noninverting',
      'summing',
      'difference',
      'instrumentation',
      'integrator',
      'differentiator',
    ]) {
      expect(runTool(spec, { ...values, mode: 'amplifier', config }).ok).toBe(true);
    }
    for (const section of ['skLow', 'skHigh', 'mfbLow']) {
      expect(runTool(spec, { ...values, mode: 'sallen', section }).ok).toBe(true);
    }
    for (const family of ['butterworth', 'chebyshev']) {
      expect(runTool(spec, { ...values, mode: 'order', family }).ok).toBe(true);
    }
    for (const kind of ['rcpass', 'rlcpass']) expect(runTool(spec, { ...values, mode: 'passive', kind }).ok).toBe(true);
    expect(runTool(spec, { ...values, mode: 'amplifier', config: 'inverting', rin: '0' }).ok).toBe(false);
    expect(runTool(spec, { ...values, mode: 'order', ap: 'x' }).ok).toBe(false);
    expect(runTool(spec, { ...values, mode: 'order', fs: '500' }).ok).toBe(false);
  });
  it('a Butterworth section (Q 0.7071) has its 3 dB point at f0', () => {
    const c = sallenKeyStage(1000, Math.SQRT1_2, 10e-9);
    const r = runTool(spec, {
      ...initialValues(spec),
      mode: 'sallen',
      section: 'skLow',
      sr1: String(c.r),
      sr2: String(c.r),
      sc1: String(c.c1),
      sc2: String(c.c2),
    });
    expect(r.ok && r.rows.find((row) => row.key === 'cutoff3db')?.value).toBe('1 kHz');
  });
});
