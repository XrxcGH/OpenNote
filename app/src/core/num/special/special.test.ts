// The special functions against Abramowitz and Stegun's tables and values computed independently with SciPy.
import { describe, expect, it } from 'vitest';
import { cx } from '../complex';
import {
  besselI,
  besselJ,
  besselJ0,
  besselJ1,
  besselJComplex,
  besselK,
  besselY,
  besselY0,
  besselY1,
  beta,
  ellipticE,
  ellipticEIncomplete,
  ellipticF,
  ellipticK,
  erf,
  erfc,
  erfinv,
  gamma,
  gammaP,
  gammaQ,
  kelvin,
  lgamma,
} from './index';

const relative = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol * Math.abs(expected));
const absolute = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

describe('Bessel functions', () => {
  it('match the tabulated values at x = 1', () => {
    absolute(besselJ0(1), 0.7651976866, 1e-9);
    absolute(besselJ1(1), 0.4400505857, 1e-9);
    absolute(besselY0(1), 0.0882569642, 1e-9);
    absolute(besselY1(1), -0.7812128213, 1e-9);
    absolute(besselI(0, 1), 1.2660658778, 1e-9);
    absolute(besselI(1, 1), 0.565159104, 1e-9);
    absolute(besselK(0, 1), 0.4210244382, 1e-9);
    absolute(besselK(1, 1), 0.6019072302, 1e-9);
  });

  it('give J0(10) and J2(5)', () => {
    absolute(besselJ(0, 10), -0.2459357645, 1e-9);
    absolute(besselJ(2, 5), 0.0465651163, 1e-9);
  });

  it('agree with SciPy across both sides of the series and asymptotic switch', () => {
    absolute(besselJ1(12), -0.22344710449062768, 1e-11);
    absolute(besselJ0(13), 0.20692610237706785, 1e-11);
    absolute(besselJ1(13), -0.07031805212177834, 1e-11);
    absolute(besselY1(12), -0.057099218260896756, 1e-11);
    absolute(besselY0(13), -0.07820786452787591, 1e-11);
    absolute(besselY1(30), 0.08442557066174713, 1e-12);
    absolute(besselY0(0.01), -3.005455637083646, 1e-12);
  });

  it('agree with SciPy for higher orders, negative x, and large and small x', () => {
    absolute(besselJ(5, 20), 0.15116976798239493, 1e-12);
    relative(besselJ(30, 10), 1.5510960782574745e-12, 1e-9);
    absolute(besselJ(3, -4), -0.43017147387562193, 1e-12);
    absolute(besselY(3, 7), 0.2680806030423151, 1e-12);
    relative(besselI(2, 40), 1.4159404985256926e16, 1e-12);
    relative(besselI(3, 5), 10.331150169151138, 1e-13);
    relative(besselI(1, -2), -1.590636854637329, 1e-13);
    relative(besselK(0, 0.01), 4.721244730161095, 1e-13);
    relative(besselK(1, 50), 3.4441022267175555e-23, 1e-12);
    relative(besselK(3, 2), 0.6473853909486342, 1e-12);
    relative(besselK(0, 700), 4.6697764316853765e-306, 1e-11);
    relative(besselK(1, 0.001), 999.9962381560855, 1e-13);
  });

  it('give J0 of a complex argument (Kelvin functions)', () => {
    const z = besselJComplex(0, cx(3 * Math.cos((3 * Math.PI) / 4), 3 * Math.sin((3 * Math.PI) / 4)));
    absolute(z.re, -0.2213802496, 1e-8);
    absolute(z.im, 1.9375867853, 1e-8);
    const { ber, bei } = kelvin(5);
    absolute(ber, -6.230082478666358, 1e-12);
    absolute(bei, 0.11603438155020042, 1e-12);
    const j1 = besselJComplex(1, cx(5 * Math.cos(Math.PI / 3), 5 * Math.sin(Math.PI / 3)));
    absolute(j1.re, 9.57501107181049, 1e-12);
    absolute(j1.im, -8.279192203270284, 1e-12);
  });

  // Reference values below come from the defining series (A&S 9.1.10, 9.6.10) summed in 80-digit decimal arithmetic,
  // where no cancellation is possible; they agree with scipy.special.jv and ive.
  it('give J0 and J1 of a complex argument far from the origin, where the series alone cancels', () => {
    relative(besselJComplex(0, cx(30)).re, -0.08636798358104021, 1e-12);
    relative(besselJComplex(0, cx(50)).re, 0.05581232766925182, 1e-11);
    relative(besselJComplex(0, cx(60)).re, -0.09147180408906187, 1e-11);
    relative(besselJComplex(1, cx(60)).re, 0.04659838375816631, 1e-11);
    const near = besselJComplex(1, cx(30, 5));
    relative(near.re, -9.215403902912666, 1e-12);
    relative(near.im, -5.470114328372871, 1e-12);
    const diagonal = besselJComplex(0, cx(60 * Math.SQRT1_2, 60 * Math.SQRT1_2));
    relative(diagonal.re, -5.087796085784348e16, 1e-12);
    relative(diagonal.im, 1.276472707406138e17, 1e-12);
    const kelvinSide = besselJComplex(1, cx(-25 * Math.SQRT1_2, 25 * Math.SQRT1_2));
    relative(kelvinSide.re, 3754808.4731430076, 1e-12);
    relative(kelvinSide.im, 64306.814393046458, 1e-11);
  });

  it('give I_n with e^-x scaling to full precision at large x and high order', () => {
    const ive = (n: number, x: number) => besselI(n, x) * Math.exp(-x);
    relative(ive(50, 31), 3.412294957711185e-17, 1e-12);
    relative(ive(50, 50), 3.404398250333589e-12, 1e-12);
    relative(ive(20, 40), 0.0004437815269118243, 1e-12);
    relative(ive(3, 100), 0.03817817317558649, 1e-12);
    relative(ive(0, 700), 0.01508129565153136, 1e-12);
  });

  it('refuse x ≤ 0 for Y and K, a fractional order, and a huge complex argument', () => {
    expect(() => besselY0(0)).toThrow(/domain/);
    expect(() => besselK(0, -1)).toThrow(/domain/);
    expect(() => besselJ(1.5, 2)).toThrow(/domain/);
    expect(() => besselJComplex(0, cx(100))).toThrow(/domain/);
    expect(besselJ(3, 0)).toBe(0);
    expect(besselJ0(0)).toBe(1);
  });
});

describe('gamma and error functions', () => {
  it('match the planned values', () => {
    relative(erf(0.5), 0.5204998778, 1e-9);
    relative(erfc(1), 0.1572992071, 1e-9);
    relative(erfc(3), 2.2090497e-5, 1e-7);
    relative(erfinv(0.5), 0.4769362762, 1e-9);
    relative(gamma(0.5), 1.7724538509, 1e-9);
    relative(gamma(4.5), 11.6317283966, 1e-9);
    relative(lgamma(100), 359.1342053696, 1e-9);
  });

  it('agree with SciPy elsewhere', () => {
    relative(erfinv(0.999999), 3.458910737275499, 1e-12);
    relative(erfinv(-0.3), -0.2724627147267544, 1e-13);
    relative(erfc(10), 2.0884875837625446e-45, 1e-12);
    relative(erf(-1.2), -0.9103139782296353, 1e-14);
    relative(gamma(-2.5), -0.9453087204829419, 1e-13);
    relative(beta(2.5, 1.5), 0.19634954084936204, 1e-13);
    relative(gammaP(2, 3), 0.8008517265285442, 1e-13);
    relative(gammaQ(0.5, 4), 0.004677734981047276, 1e-12);
    relative(gammaP(10, 2), 4.649807501726386e-5, 1e-12);
    expect(gamma(5)).toBe(24);
  });

  it('say where they are undefined', () => {
    expect(() => gamma(0)).toThrow(/domain/);
    expect(() => gamma(-3)).toThrow(/domain/);
    expect(() => lgamma(-1)).toThrow(/domain/);
    expect(() => erfinv(1.5)).toThrow(/domain/);
    expect(erfinv(1)).toBe(Infinity);
    expect(() => gammaP(-1, 2)).toThrow(/domain/);
    expect(gamma(200)).toBe(Infinity);
  });
});

describe('elliptic integrals', () => {
  it('match the planned values at m = 0.5', () => {
    absolute(ellipticK(0.5), 1.8540746773, 1e-9);
    absolute(ellipticE(0.5), 1.350643881, 1e-9);
    absolute(ellipticF(Math.PI / 4, 0.5), 0.8260178762, 1e-9);
    absolute(ellipticEIncomplete(Math.PI / 4, 0.5), 0.7481865042, 1e-9);
  });

  it('agree with SciPy beyond π/2, for negative m, and near m = 1', () => {
    relative(ellipticF(2, 0.7), 2.8129250806472124, 1e-13);
    relative(ellipticEIncomplete(2, 0.7), 1.4921133460664466, 1e-13);
    relative(ellipticEIncomplete(4, 0.3), 3.7210652682686027, 1e-13);
    relative(ellipticF(-1.2, -0.5), -1.11068763176032, 1e-13);
    relative(ellipticK(0.99), 3.6956373629898747, 1e-13);
    relative(ellipticE(0.99), 1.015993545025224, 1e-13);
    relative(ellipticK(-1), 1.3110287771460598, 1e-13);
    relative(ellipticE(-1), 1.9100988945138562, 1e-13);
    expect(ellipticK(0)).toBeCloseTo(Math.PI / 2, 15);
    expect(ellipticE(1)).toBe(1);
  });

  it('refuse m ≥ 1 for K', () => {
    expect(() => ellipticK(1)).toThrow(/domain/);
    expect(() => ellipticF(Math.PI / 2, 1)).toThrow(/domain/);
  });
});
