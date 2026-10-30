// State-space design against the plan's cases and independent checks: closed-loop characteristic polynomials by
// Leverrier, the Riccati residual, closed forms for scalar systems, and the separation principle.
import { describe, expect, it } from 'vitest';
import { ControlError, readNumberMatrix } from '../lib/errors';
import { add, leverrier, MatError, mul, type Mat } from '../lib/linalg';
import { cx, polyFromRoots, pmulCheck } from './testkit';
import { ackermann, analyzeSS, lqr, makeSS, observerGain, observerResponses, stepResponse } from './engine';

const A: Mat = [
  [0, 1],
  [0, 0],
];
const B: Mat = [[0], [1]];
const C: Mat = [[1, 0]];

/** det(sI − M), highest power first. */
const charPoly = (m: Mat) => leverrier(m).coeffs;
const expectPoly = (got: readonly number[], want: readonly number[], tol = 1e-9) => {
  expect(got.length).toBe(want.length);
  got.forEach((g, i) => expect(g).toBeCloseTo(want[i], -Math.log10(tol)));
};

describe('validation cases', () => {
  it('double integrator, poles −2 ± 2i: K = [8, 4]', () => {
    const r = ackermann(A, B, [cx(-2, 2), cx(-2, -2)]);
    expect(r.k[0][0]).toBeCloseTo(8, 9);
    expect(r.k[0][1]).toBeCloseTo(4, 9);
    // Independent: det(sI − (A − BK)) = s² + 4s + 8.
    expectPoly(charPoly(add(A, mul(B, r.k), -1)), [1, 4, 8]);
  });

  it('double integrator LQR, Q = I, R = 1: K = [1, √3], P = [√3, 1; 1, √3]', () => {
    const r = lqr(
      A,
      B,
      [
        [1, 0],
        [0, 1],
      ],
      [[1]],
    );
    const s3 = Math.sqrt(3);
    expect(r.k[0][0]).toBeCloseTo(1, 6);
    expect(r.k[0][1]).toBeCloseTo(s3, 6);
    expect(r.p[0][0]).toBeCloseTo(s3, 6);
    expect(r.p[0][1]).toBeCloseTo(1, 6);
    expect(r.p[1][0]).toBeCloseTo(1, 6);
    expect(r.p[1][1]).toBeCloseTo(s3, 6);
    expect(r.residual).toBeLessThan(1e-10);
  });

  it('observer with C = [1 0], poles −5, −5: L = [10, 25]', () => {
    const r = observerGain(A, C, [cx(-5), cx(-5)]);
    expect(r.k[0][0]).toBeCloseTo(10, 9);
    expect(r.k[1][0]).toBeCloseTo(25, 9);
    expectPoly(charPoly(add(A, mul(r.k, C), -1)), [1, 10, 25]);
  });
});

/** A matrix from text, rows split by semicolons, so the cases stay one line each. */
const m = (text: string): Mat => readNumberMatrix(text);
const DIAG = m('-1 0; 0 -2');

describe('LQR against closed forms', () => {
  it('scalar LQR matches the closed form P = r(a + √(a² + b²q/r))/b²', () => {
    for (const [a, b, q, rr] of [
      [1, 1, 1, 1],
      [-2, 3, 5, 0.5],
      [0, 2, 1e-4, 10],
    ]) {
      const r = lqr([[a]], [[b]], [[q]], [[rr]]);
      const p = (rr * (a + Math.sqrt(a * a + (b * b * q) / rr))) / (b * b);
      expect(r.p[0][0]).toBeCloseTo(p, 8);
      expect(r.k[0][0]).toBeCloseTo((b * p) / rr, 8);
    }
  });

  it('a third-order plant satisfies the Riccati equation', () => {
    const l = lqr(m('0 1 0; 0 0 1; -6 -11 -6'), m('0; 0; 1'), m('10 0 0; 0 1 0; 0 0 1'), [[0.1]]);
    expect(l.residual).toBeLessThan(1e-9);
    expect(l.closed.every((z) => z.re < 0)).toBe(true);
  });

  it('two inputs: LQR with a diagonal R', () => {
    const r = lqr(m('1 2; 0 -1'), m('1 0; 0 1'), m('1 0; 0 1'), m('1 0; 0 2'));
    expect(r.k).toHaveLength(2);
    expect(r.residual).toBeLessThan(1e-9);
  });
});

describe('placement against independent checks', () => {
  it('in controllable canonical form K = α − a, coefficient by coefficient', () => {
    const want = [cx(-3), cx(-4, 1), cx(-4, -1)];
    const r = ackermann(m('0 1 0; 0 0 1; -6 -11 -6'), m('0; 0; 1'), want);
    const alpha = polyFromRoots(want); // lowest first
    expect(r.k[0][0]).toBeCloseTo(alpha[0] - 6, 8);
    expect(r.k[0][1]).toBeCloseTo(alpha[1] - 11, 8);
    expect(r.k[0][2]).toBeCloseTo(alpha[2] - 6, 8);
  });

  it('separation: the observer loop has the controller poles and the observer poles', () => {
    const ss = makeSS(A, B, C, null);
    const k = ackermann(A, B, [cx(-2, 2), cx(-2, -2)]).k;
    const l = observerGain(A, C, [cx(-5), cx(-5)]).k;
    const r = observerResponses(ss, k, l, [1, 0], 4);
    expectPoly(charPoly(r.combined), pmulCheck([1, 4, 8], [1, 10, 25]), 1e-6);
    // With the true state the output is the regulator's; the observer's differs early and agrees late.
    expect(r.fullState[0]).toBeCloseTo(1, 12);
    expect(Math.abs(r.withObserver[r.t.length - 1])).toBeLessThan(1e-2);
  });

  it('the step response with N̄ or integral action settles at 1', () => {
    const ss = makeSS(A, B, C, null);
    const plain = stepResponse(ss, ackermann(A, B, [cx(-2, 2), cx(-2, -2)]).k, false, 8);
    expect(plain?.n).toBeCloseTo(8, 9);
    expect(plain?.y.at(-1)).toBeCloseTo(1, 4);
    const { a, b } = { a: m('0 1 0; 0 0 0; -1 0 0'), b: m('0; 1; 0') };
    const ki = ackermann(a, b, [cx(-2), cx(-2), cx(-2)]);
    expectPoly(charPoly(add(a, mul(b, ki.k), -1)), [1, 6, 12, 8]);
    const withI = stepResponse(ss, ki.k, true, 12);
    expect(withI?.y.at(-1)).toBeCloseTo(1, 4);
  });

  it('reports ranks and poles', () => {
    const r = analyzeSS(makeSS(DIAG, m('1; 0'), m('1 1'), null));
    expect(r.ctrbRank).toBe(1);
    expect(r.obsvRank).toBe(2);
    const re = r.poles.map((p) => p.re).sort((x, y) => x - y);
    expect(re[0]).toBeCloseTo(-2, 12);
    expect(re[1]).toBeCloseTo(-1, 12);
  });

  it('copes with a zero plant and large entries', () => {
    expect(ackermann([[0]], [[1]], [cx(-3)]).k[0][0]).toBeCloseTo(3, 12);
    const a = m('0 1e3; 0 0');
    const b = m('0; 1e3');
    const big = ackermann(a, b, [cx(-2e3), cx(-3e3)]);
    expectPoly(charPoly(add(a, mul(b, big.k), -1)), [1, 5e3, 6e6], 1e-3);
  });
});

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof ControlError || e instanceof MatError) return e.code;
    throw e;
  }
  return 'none';
};

describe('impossible input', () => {
  const I2 = m('1 0; 0 1');
  const cases: [string, () => unknown][] = [
    ['notSquare', () => makeSS([[1, 2]], [[1]], [[1]], null)],
    ['bRows', () => makeSS(A, [[1]], C, null)],
    ['cCols', () => makeSS(A, B, [[1]], null)],
    ['dShape', () => makeSS(A, B, C, [[0, 0]])],
    [
      'tooManyStates',
      () =>
        makeSS(
          Array.from({ length: 9 }, () => new Array<number>(9).fill(0)),
          [[0]],
          [[0]],
          null,
        ),
    ],
    ['polesCount', () => ackermann(A, B, [cx(-1)])],
    ['polesConjugate', () => ackermann(A, B, [cx(-1, 1), cx(-2)])],
    ['uncontrollable', () => ackermann(DIAG, m('1; 0'), [cx(-3), cx(-4)])],
    ['unobservable', () => observerGain(DIAG, m('1 0'), [cx(-3), cx(-4)])],
    ['singleInput', () => ackermann(A, I2, [cx(-1), cx(-2)])],
    ['qShape', () => lqr(A, B, [[1]], [[1]])],
    ['rPositive', () => lqr(A, B, I2, [[0]])],
    ['qSymmetric', () => lqr(A, B, m('1 2; 0 1'), [[1]])],
    ['qNegative', () => lqr(A, B, m('-1 0; 0 1'), [[1]])],
    // An unstable mode the input cannot reach cannot be stabilized.
    ['noConverge', () => lqr(m('1 0; 0 -1'), m('0; 1'), I2, [[1]])],
  ];
  it.each(cases)('names %s', (want, f) => expect(code(f)).toBe(want));
});
