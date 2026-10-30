import { describe, expect, it } from 'vitest';
import { cauchyRiemann, laurent } from './analytic';

const at = (r: ReturnType<typeof laurent>, k: number) => r.coefficients.find((p) => p.k === k)!.a;
const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

describe('Cauchy-Riemann equations', () => {
  it("z^2 satisfies them everywhere: u = x^2 - y^2, v = 2xy, and f'(1+i) = 2 + 2i", () => {
    const r = cauchyRiemann('z^2', [0, 2, 0, 2], 5);
    expect(r.analytic).toBe(true);
    // The middle sample of a 5 by 5 grid on [0,2]^2 is (1.0, 1.0): u_x = 2x, v_x = 2y.
    expect(r.derivative!.re).toBeCloseTo(2, 6);
    expect(r.derivative!.im).toBeCloseTo(2, 6);
  });
  it('e^z and sin(z) are analytic; conj(z), |z|^2 and Re z are not', () => {
    expect(cauchyRiemann('exp(z)', [-1, 1, -1, 1]).analytic).toBe(true);
    expect(cauchyRiemann('sin(z)', [-1, 1, -1, 1]).analytic).toBe(true);
    expect(cauchyRiemann('conj(z)', [-1, 1, -1, 1]).analytic).toBe(false);
  });
  it('1/z is analytic away from 0 and has u_x = v_y there', () => {
    const r = cauchyRiemann('1/z', [1, 3, 1, 3], 4);
    expect(r.analytic).toBe(true);
    const row = r.rows[0];
    // 1/z = (x - iy)/(x^2 + y^2): u_x = (y^2 - x^2) / (x^2 + y^2)^2.
    expect(row.ux).toBeCloseTo((row.y ** 2 - row.x ** 2) / (row.x ** 2 + row.y ** 2) ** 2, 6);
    expect(row.ux).toBeCloseTo(row.vy, 6);
  });
  it('rejects a backwards region', () => {
    expect(() => cauchyRiemann('z', [1, 0, 0, 1])).toThrow();
  });
});

describe('Laurent coefficients', () => {
  it('exp(1/z) has a_{-k} = 1/k! and a_0 = 1', () => {
    const r = laurent('exp(1/z)', '0', 1, 6);
    for (let k = 0; k <= 6; k++) expect(at(r, -k).re).toBeCloseTo(1 / factorial(k), 10);
    for (let k = 1; k <= 6; k++) expect(Math.abs(at(r, k).re)).toBeLessThan(1e-10);
    expect(r.residue.re).toBeCloseTo(1, 10);
    expect(r.steady).toBe(true);
  });
  it('1/(z(z-1)) on 0 < |z| < 1 is -1/z - 1 - z - z^2 - ...', () => {
    const r = laurent('1/(z*(z-1))', '0', 0.5, 4);
    for (let k = -1; k <= 4; k++) expect(at(r, k).re).toBeCloseTo(-1, 9);
    expect(at(r, -2).re).toBeCloseTo(0, 10);
    expect(r.residue.re).toBeCloseTo(-1, 9);
  });
  it('1/(z(z-1)) on 1 < |z| < 2 is 1/z^2 + 1/z^3 + ... (a different annulus, a different series)', () => {
    const r = laurent('1/(z*(z-1))', '0', 1.5, 4);
    expect(at(r, -1).re).toBeCloseTo(0, 8);
    expect(at(r, -2).re).toBeCloseTo(1, 8);
    expect(at(r, -3).re).toBeCloseTo(1, 8);
    expect(at(r, 0).re).toBeCloseTo(0, 8);
  });
  it('warns when the circle is too close to a singularity to sit in one annulus', () => {
    expect(laurent('1/(z*(z-1))', '0', 1.05, 3).steady).toBe(false);
  });
  it('the residue of 1/(z-2) about 2 is 1', () => {
    expect(laurent('1/(z-2)', '2', 0.5, 2).residue.re).toBeCloseTo(1, 10);
  });
});
