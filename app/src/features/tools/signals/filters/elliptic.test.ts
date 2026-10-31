// The elliptic prototype, checked against values the engine does not compute its own way: the complete elliptic
// integral by the arithmetic-geometric mean, the order-2 elliptic rational function in closed form, and the defining
// equiripple bounds of the response.
import { describe, expect, it } from 'vitest';
import { SignalError } from '../shared/errors';
import { cabs, cdiv, cmul, csub, cx, type Complex } from '../shared/num';
import { ellipticPrototype, ellipticSelectivity } from './elliptic';
import { designIir, IIR } from './FilterView';
import { iirBilinear, response } from './design';

/** K(m) = π / (2·AGM(1, √(1 − m²))), m the modulus. */
function bigK(m: number): number {
  let a = 1;
  let b = Math.sqrt(1 - m * m);
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-16; i += 1) [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  return Math.PI / (2 * a);
}

const analogDb = (proto: { z: Complex[]; p: Complex[]; k: number }, w: number) => {
  const s = cx(0, w);
  const top = proto.z.reduce((acc, r) => cmul(acc, csub(s, r)), cx(proto.k));
  const bottom = proto.p.reduce((acc, r) => cmul(acc, csub(s, r)), cx(1));
  return 20 * Math.log10(cabs(cdiv(top, bottom)));
};
const k1Of = (rp: number, rs: number) => Math.sqrt((10 ** (rp / 10) - 1) / (10 ** (rs / 10) - 1));

describe('elliptic prototype', () => {
  it('solves the degree equation N·K′/K = K₁′/K₁ for orders 2 to 8', () => {
    for (const [n, rp, rs] of [
      [2, 1, 30],
      [3, 0.5, 40],
      [4, 1, 40],
      [5, 0.1, 60],
      [8, 1, 80],
    ] as const) {
      const k = ellipticSelectivity(n, rp, rs);
      const k1 = k1Of(rp, rs);
      const lhs = (n * bigK(Math.sqrt(1 - k * k))) / bigK(k);
      const rhs = bigK(Math.sqrt(1 - k1 * k1)) / bigK(k1);
      expect(Math.abs(lhs / rhs - 1)).toBeLessThan(1e-7);
    }
  });

  it('matches the order-2 closed form: k = 2√k₁/(1 + k₁) and R₂(ω) = ((t + 1)ω² − 1)/((t − 1)ω² + 1)', () => {
    const rp = 1;
    const rs = 30;
    const k1 = k1Of(rp, rs);
    const proto = ellipticPrototype(2, rp, rs);
    expect(proto.selectivity).toBeCloseTo((2 * Math.sqrt(k1)) / (1 + k1), 10);
    const t = Math.sqrt(1 - proto.selectivity ** 2);
    const ep2 = 10 ** (rp / 10) - 1;
    for (const w of [0, 0.5, 1, 2, 5]) {
      const r2 = ((t + 1) * w * w - 1) / ((t - 1) * w * w + 1);
      expect(analogDb(proto, w)).toBeCloseTo(-10 * Math.log10(1 + ep2 * r2 * r2), 6);
    }
  });

  it('puts the order-1 pole at −1/ε, as for a first-order Chebyshev I', () => {
    const proto = ellipticPrototype(1, 1, 40);
    expect(proto.z).toHaveLength(0);
    expect(proto.p[0]!.re).toBeCloseTo(-1 / Math.sqrt(10 ** 0.1 - 1), 9);
  });

  it('keeps an order-5 response equiripple: 0 to −Rp in the passband, at least Rs from 1/k on', () => {
    const proto = ellipticPrototype(5, 0.5, 50);
    const k = proto.selectivity;
    expect(analogDb(proto, 1)).toBeCloseTo(-0.5, 7);
    expect(analogDb(proto, 1 / k)).toBeCloseTo(-50, 6);
    for (let i = 0; i <= 400; i += 1) {
      const pass = analogDb(proto, i / 400);
      expect(pass).toBeLessThan(1e-9);
      expect(pass).toBeGreaterThan(-0.5 - 1e-7);
      expect(analogDb(proto, (1 / k) * (1 + i / 20))).toBeLessThan(-50 + 1e-6);
    }
    // Every pole in the left half-plane, the zeros on the imaginary axis.
    proto.p.forEach((p) => expect(p.re).toBeLessThan(0));
    proto.z.forEach((z) => expect(Math.abs(z.re)).toBeLessThan(1e-12));
  });
});

describe('elliptic digital filters', () => {
  const gainDb = (b: number[], a: number[], f: number, fs: number) =>
    20 * Math.log10(cabs(response(b, a, (2 * Math.PI * f) / fs)));

  it('gives an order-4 lowpass (1 dB, 40 dB) at 1 kHz, fs 8 kHz, −1 dB at DC and the edge and −40 dB at the warped stop edge', () => {
    const { b, a, steps } = iirBilinear('elliptic', 'lowpass', 4, 1000, 0, 8000, 1, 40);
    expect(gainDb(b, a, 0, 8000)).toBeCloseTo(-1, 7);
    expect(gainDb(b, a, 1000, 8000)).toBeCloseTo(-1, 7);
    const k = ellipticSelectivity(4, 1, 40);
    const fStop = (8000 / Math.PI) * Math.atan(Math.tan(Math.PI / 8) / k);
    expect(gainDb(b, a, fStop, 8000)).toBeCloseTo(-40, 5);
    for (let f = fStop; f < 4000; f += 25) expect(gainDb(b, a, f, 8000)).toBeLessThan(-40 + 1e-5);
    expect(steps.map((s) => s.key)).toContain('filterEllipticEdge');
  });

  it('puts a bandpass and a highpass at −Rp on their edges', () => {
    const bp = iirBilinear('elliptic', 'bandpass', 3, 800, 1600, 8000, 0.5, 45);
    expect(gainDb(bp.b, bp.a, 800, 8000)).toBeCloseTo(-0.5, 6);
    expect(gainDb(bp.b, bp.a, 1600, 8000)).toBeCloseTo(-0.5, 6);
    const hp = iirBilinear('elliptic', 'highpass', 3, 500, 0, 8000, 1, 40);
    expect(gainDb(hp.b, hp.a, 500, 8000)).toBeCloseTo(-1, 6);
    expect(gainDb(hp.b, hp.a, 4000, 8000)).toBeCloseTo(0, 6);
  });

  it('refuses an attenuation not above the ripple, and impulse invariance for filters with zeros', () => {
    const key = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof SignalError ? error.key : 'other';
      }
      return 'none';
    };
    expect(key(() => iirBilinear('elliptic', 'lowpass', 4, 1000, 0, 8000, 3, 3))).toBe('ellipticSpec');
    expect(key(() => iirBilinear('elliptic', 'lowpass', 4, 1000, 0, 8000, 0, 40))).toBe('ripple');
    expect(key(() => iirBilinear('elliptic', 'lowpass', 4, 1000, 0, 8000, 1, 0))).toBe('attenuation');
    expect(key(() => designIir({ ...IIR, type: 'elliptic', method: 'impulse' }))).toBe('impulseAllPole');
    expect(key(() => designIir({ ...IIR, type: 'chebyshev2', method: 'impulse' }))).toBe('impulseAllPole');
  });

  it('stays finite at order 12 with a 120 dB stopband', () => {
    const { b, a } = iirBilinear('elliptic', 'lowpass', 12, 1000, 0, 8000, 0.1, 120);
    expect([...b, ...a].every(Number.isFinite)).toBe(true);
    expect(gainDb(b, a, 1000, 8000)).toBeCloseTo(-0.1, 4);
  });
});
