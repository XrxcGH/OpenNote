// Dipping-layer refraction and the Omori-Utsu fit, each checked against a value worked out another way: the head
// wave's travel time traced ray by ray along the tilted interface, and aftershock times made from a known law.
import { describe, expect, it } from 'vitest';
import { dippingFromApparent, dippingRefraction, refraction } from './engine';
import { omoriCount, omoriUtsu } from './omori';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('dipping-layer refraction', () => {
  const [v1, v2, hUp, hDown, spread] = [1500, 4000, 20, 30, 200];
  const d = dippingRefraction(v1, v2, hUp, hDown, spread);

  it('matches the head-wave time traced down, along, and up the tilted interface', () => {
    const theta = Math.asin(v1 / v2);
    const delta = Math.asin((hDown - hUp) / spread);
    for (const x of [80, 140, 200]) {
      // Down at θc to the interface, along it at V₂, up at θc to a receiver hUp + x sin δ above it.
      const hx = hUp + x * Math.sin(delta);
      const ray = (hUp + hx) / (v1 * Math.cos(theta)) + (x * Math.cos(delta) - (hUp + hx) * Math.tan(theta)) / v2;
      expect(rel(d.interceptDown + x / d.down, ray)).toBeLessThan(1e-12);
    }
  });

  it('gives the same reciprocal time from both ends, and the flat case at zero dip', () => {
    expect(rel(d.interceptDown + spread / d.down, d.interceptUp + spread / d.up)).toBeLessThan(1e-12);
    expect(d.down).toBeLessThan(v2);
    expect(d.up).toBeGreaterThan(v2);
    const flat = dippingRefraction(v1, v2, 20, 20, spread);
    expect(flat.dip).toBe(0);
    expect(rel(flat.interceptDown, refraction(v1, v2, 20).intercept)).toBeLessThan(1e-12);
  });

  it('recovers the dip, V₂, and both depths from the apparent speeds and intercepts', () => {
    const back = dippingFromApparent(v1, d.down, d.up, d.interceptDown, d.interceptUp);
    expect(rel(back.v2, v2)).toBeLessThan(1e-12);
    expect(rel(back.dip, (Math.asin(10 / 200) * 180) / Math.PI)).toBeLessThan(1e-12);
    expect(rel(back.hUp, hUp)).toBeLessThan(1e-12);
    expect(rel(back.hDown, hDown)).toBeLessThan(1e-12);
    // A 2.87° dip leaves the gentle-dip estimate within 0.2% of V₂.
    expect(rel(back.v2Approx, v2)).toBeLessThan(2e-3);
    expect(() => dippingRefraction(v1, v2, 20, 300, 200)).toThrow();
    expect(() => dippingFromApparent(v1, 1400, 4000, 0.02, 0.03)).toThrow();
  });
});

describe('Omori-Utsu decay', () => {
  it('counts ln(1 + t/c) K at p = 1 and approaches it from either side', () => {
    expect(rel(omoriCount(10, 5, 0.1, 1), 5 * Math.log(101))).toBeLessThan(1e-12);
    expect(rel(omoriCount(10, 5, 0.1, 1 + 1e-7), 5 * Math.log(101))).toBeLessThan(1e-5);
  });

  it('recovers K, c, and p from times placed on a known law', () => {
    // N(t) = K[c^q − ... ]: invert N(tᵢ) = i in closed form for K = 10, c = 0.05, p = 1.1.
    const [K, c, p] = [10, 0.05, 1.1];
    const q = 1 - p;
    const times = Array.from({ length: 60 }, (_, i) => (c ** q - ((i + 1) * (p - 1)) / K) ** (1 / q) - c);
    const fit = omoriUtsu(times);
    expect(rel(fit.k, K)).toBeLessThan(1e-4);
    expect(rel(fit.c, c)).toBeLessThan(1e-4);
    expect(rel(fit.p, p)).toBeLessThan(1e-4);
    expect(() => omoriUtsu([1, 2, 3])).toThrow();
    expect(() => omoriUtsu([0, 1, 2, 3, 4])).toThrow();
  });
});
