// Macroeconomic models: the Keynesian cross, IS-LM, the Solow growth model with growth accounting, the Taylor rule
// and Phillips curve, money and price relations, parity conditions, and first-order difference equations.
import { solveLinear } from './num';

export interface Cross {
  income: number;
  consumption: number;
  taxes: number;
  spendingMultiplier: number;
  taxMultiplier: number;
  balancedBudgetMultiplier: number;
}

/** C = c0 + c1 (Y - T), T = t0 + t1 Y, with investment I and government purchases G fixed. */
export function keynesianCross(
  c0: number,
  c1: number,
  t0: number,
  t1: number,
  invest: number,
  gov: number,
): Cross | null {
  const leakage = 1 - c1 * (1 - t1);
  if (!(c1 >= 0) || !(c1 < 1) || !(t1 >= 0) || !(t1 < 1) || !(leakage > 0)) return null;
  const income = (c0 - c1 * t0 + invest + gov) / leakage;
  const taxes = t0 + t1 * income;
  return {
    income,
    consumption: c0 + c1 * (income - taxes),
    taxes,
    spendingMultiplier: 1 / leakage,
    taxMultiplier: -c1 / leakage,
    balancedBudgetMultiplier: (1 - c1) / leakage,
  };
}

export interface IsLm {
  income: number;
  rate: number;
}

export interface IsLmParams {
  c0: number;
  c1: number;
  tax: number;
  i0: number;
  i1: number;
  gov: number;
  /** Real money supply M/P. */
  money: number;
  k: number;
  h: number;
}

/** IS: Y = c0 + c1 (Y - T) + i0 - i1 r + G. LM: M/P = k Y - h r. */
export function isLm(p: IsLmParams): IsLm | null {
  if (!(p.c1 >= 0) || !(p.c1 < 1) || !(p.i1 >= 0) || !(p.h > 0) || !(p.k >= 0)) return null;
  // (1 - c1) Y + i1 r = c0 - c1 T + i0 + G ; k Y - h r = M/P
  const sol = solveLinear(
    [
      [1 - p.c1, p.i1],
      [p.k, -p.h],
    ],
    [p.c0 - p.c1 * p.tax + p.i0 + p.gov, p.money],
  );
  return sol ? { income: sol[0], rate: sol[1] } : null;
}

export interface Solow {
  capital: number;
  output: number;
  consumption: number;
  investment: number;
  goldenSaving: number;
  goldenCapital: number;
}

/** Output per effective worker y = k^alpha; capital per effective worker grows by s y - (n + g + delta) k. */
export function solowSteadyState(s: number, n: number, delta: number, alpha: number, g = 0): Solow | null {
  const loss = n + g + delta;
  if (!(s > 0) || !(s < 1) || !(alpha > 0) || !(alpha < 1) || !(loss > 0)) return null;
  const capital = (s / loss) ** (1 / (1 - alpha));
  const output = capital ** alpha;
  return {
    capital,
    output,
    consumption: (1 - s) * output,
    investment: s * output,
    goldenSaving: alpha,
    goldenCapital: (alpha / loss) ** (1 / (1 - alpha)),
  };
}

/** Capital per effective worker over `periods` periods from k0, including the starting value. */
export function solowPath(
  s: number,
  n: number,
  delta: number,
  alpha: number,
  k0: number,
  periods: number,
  g = 0,
): number[] {
  const path = [k0];
  for (let t = 0; t < periods; t += 1) {
    const k = path[t];
    path.push(k + s * k ** alpha - (n + g + delta) * k);
  }
  return path;
}

/** The Solow residual: output growth not explained by capital and labour growth. */
export const solowResidual = (gY: number, gK: number, gL: number, alpha: number): number =>
  gY - alpha * gK - (1 - alpha) * gL;

/** Taylor rule: i = r* + pi + a (pi - pi*) + b gap, all in percent. */
export const taylorRate = (neutral: number, inflation: number, target: number, gap: number, a = 0.5, b = 0.5): number =>
  neutral + inflation + a * (inflation - target) + b * gap;

/** Expectations-augmented Phillips curve: inflation = expected - slope (u - natural) + shock. */
export const phillips = (expected: number, slope: number, unemployment: number, natural: number, shock = 0): number =>
  expected - slope * (unemployment - natural) + shock;

/** Quantity theory M V = P Y: solve for the one that is null. */
export function quantityTheory(
  m: number | null,
  v: number | null,
  p: number | null,
  y: number | null,
): { m: number; v: number; p: number; y: number } | null {
  const missing = [m, v, p, y].filter((x) => x === null).length;
  if (missing !== 1) return null;
  if (m === null) return { m: (p! * y!) / v!, v: v!, p: p!, y: y! };
  if (v === null) return { m, v: (p! * y!) / m, p: p!, y: y! };
  if (p === null) return { m, v: v!, p: (m * v!) / y!, y: y! };
  return { m, v: v!, p, y: (m * v!) / p };
}

/** The money multiplier with a currency-deposit ratio and a reserve-deposit ratio. */
export const moneyMultiplier = (currency: number, reserve: number): number | null =>
  currency + reserve > 0 ? (1 + currency) / (currency + reserve) : null;

/** The exact Fisher relation: (1 + i) = (1 + r)(1 + pi), all as fractions. */
export const nominalRate = (real: number, inflation: number): number => (1 + real) * (1 + inflation) - 1;

/** Covered interest parity: the forward rate (domestic per foreign) from the spot and the two interest rates. */
export const forwardRate = (spot: number, domestic: number, foreign: number): number =>
  (spot * (1 + domestic)) / (1 + foreign);

/** Relative purchasing power parity: the expected exchange rate after the two price levels change. */
export const pppRate = (spot: number, domesticInflation: number, foreignInflation: number): number =>
  (spot * (1 + domesticInflation)) / (1 + foreignInflation);

export interface Difference {
  fixedPoint: number | null;
  stable: boolean;
  path: number[];
}

/** x(t+1) = a x(t) + b from x0. */
export function difference(a: number, b: number, x0: number, periods: number): Difference {
  const path = [x0];
  for (let t = 0; t < periods; t += 1) path.push(a * path[t] + b);
  return { fixedPoint: a === 1 ? null : b / (1 - a), stable: Math.abs(a) < 1, path };
}
