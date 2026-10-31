// Consumer and producer choice as pure functions. Prices and incomes are positive numbers.
import { brent } from './num';

export type UtilityKind = 'cd' | 'subs' | 'compl' | 'quasi' | 'ces';

export interface Utility {
  kind: UtilityKind;
  a: number;
  b: number;
  /** The CES exponent: below 1 and not 0. */
  rho?: number;
}

export interface Bundle {
  x: number;
  y: number;
}

export function validUtility(u: Utility): boolean {
  if (!(u.a > 0) || !(u.b > 0)) return false;
  if (u.kind === 'ces') return u.rho !== undefined && u.rho < 1 && u.rho !== 0;
  return true;
}

export function utility(u: Utility, x: number, y: number): number {
  switch (u.kind) {
    case 'cd':
      return x ** u.a * y ** u.b;
    case 'subs':
      return u.a * x + u.b * y;
    case 'compl':
      return Math.min(u.a * x, u.b * y);
    case 'quasi':
      return u.a * Math.log(x) + y;
    default:
      return (u.a * x ** u.rho! + u.b * y ** u.rho!) ** (1 / u.rho!);
  }
}

/** The bundle that maximizes utility at prices px and py with income I. */
export function marshallian(u: Utility, px: number, py: number, income: number): Bundle | null {
  if (!validUtility(u) || !(px > 0) || !(py > 0) || !(income > 0)) return null;
  switch (u.kind) {
    case 'cd':
      return { x: (u.a / (u.a + u.b)) * (income / px), y: (u.b / (u.a + u.b)) * (income / py) };
    case 'subs':
      return u.a / px >= u.b / py ? { x: income / px, y: 0 } : { x: 0, y: income / py };
    case 'compl': {
      const x = (u.b * income) / (u.b * px + u.a * py);
      return { x, y: (u.a * x) / u.b };
    }
    case 'quasi': {
      const x = (u.a * py) / px;
      return px * x <= income ? { x, y: (income - px * x) / py } : { x: income / px, y: 0 };
    }
    default: {
      const s = 1 / (1 - u.rho!);
      const denominator = u.a ** s * px ** (1 - s) + u.b ** s * py ** (1 - s);
      return { x: (income * u.a ** s * px ** -s) / denominator, y: (income * u.b ** s * py ** -s) / denominator };
    }
  }
}

/** The least income that reaches utility `target` at the prices (the expenditure function). */
export function expenditure(u: Utility, px: number, py: number, target: number): number | null {
  const value = (income: number) => {
    const bundle = marshallian(u, px, py, income);
    return bundle ? utility(u, Math.max(bundle.x, 1e-300), Math.max(bundle.y, 1e-300)) - target : NaN;
  };
  let hi = 1;
  for (let i = 0; i < 200 && !(value(hi) >= 0); i += 1) hi *= 2;
  return brent(value, 1e-12, hi, 1e-12);
}

export interface Slutsky {
  before: Bundle;
  after: Bundle;
  compensated: Bundle;
  substitutionX: number;
  incomeX: number;
  totalX: number;
  substitutionY: number;
  incomeY: number;
  compensatingVariation: number;
  equivalentVariation: number;
  utilityBefore: number;
  utilityAfter: number;
}

/** The effect of a price change from (px0, py0) to (px1, py1) at income I, split into substitution and income. */
export function slutsky(
  u: Utility,
  px0: number,
  py0: number,
  px1: number,
  py1: number,
  income: number,
): Slutsky | null {
  const before = marshallian(u, px0, py0, income);
  const after = marshallian(u, px1, py1, income);
  if (!before || !after) return null;
  const u0 = utility(u, Math.max(before.x, 1e-300), Math.max(before.y, 1e-300));
  const u1 = utility(u, Math.max(after.x, 1e-300), Math.max(after.y, 1e-300));
  const need = expenditure(u, px1, py1, u0);
  const old = expenditure(u, px0, py0, u1);
  if (need === null || old === null) return null;
  const compensated = marshallian(u, px1, py1, need)!;
  return {
    before,
    after,
    compensated,
    substitutionX: compensated.x - before.x,
    incomeX: after.x - compensated.x,
    totalX: after.x - before.x,
    substitutionY: compensated.y - before.y,
    incomeY: after.y - compensated.y,
    compensatingVariation: need - income,
    equivalentVariation: income - old,
    utilityBefore: u0,
    utilityAfter: u1,
  };
}

/** The y that keeps utility at `level` for a given x on an indifference curve, or null where there is none. */
export function indifferenceY(u: Utility, level: number, x: number): number | null {
  if (!(x > 0)) return null;
  let y: number;
  switch (u.kind) {
    case 'cd':
      y = (level / x ** u.a) ** (1 / u.b);
      break;
    case 'subs':
      y = (level - u.a * x) / u.b;
      break;
    case 'compl':
      y = x < level / u.a ? level / u.b : Infinity;
      break;
    case 'quasi':
      y = level - u.a * Math.log(x);
      break;
    default: {
      const inner = (level ** u.rho! - u.a * x ** u.rho!) / u.b;
      y = inner > 0 ? inner ** (1 / u.rho!) : Infinity;
    }
  }
  return Number.isFinite(y) && y >= 0 ? y : null;
}

export type ProductionKind = 'cd' | 'leontief' | 'linear';

export interface Production {
  kind: ProductionKind;
  /** Scale A for Cobb-Douglas; otherwise the weight on capital. */
  a: number;
  /** The exponent on capital for Cobb-Douglas; otherwise the weight on labor. */
  b: number;
  /** The exponent on labor for Cobb-Douglas. */
  c?: number;
}

export interface CostMin {
  capital: number;
  labor: number;
  cost: number;
  returns: 'increasing' | 'constant' | 'decreasing' | null;
  mrts: number | null;
}

/** Least-cost inputs for output Q at wage w and rental rate r. */
export function costMinimization(p: Production, w: number, r: number, q: number): CostMin | null {
  if (!(w > 0) || !(r > 0) || !(q > 0) || !(p.a > 0) || !(p.b > 0)) return null;
  if (p.kind === 'cd') {
    const alpha = p.b;
    const beta = p.c ?? 0;
    if (!(beta > 0)) return null;
    const ratio = (alpha * w) / (beta * r);
    const labor = (q / (p.a * ratio ** alpha)) ** (1 / (alpha + beta));
    const capital = ratio * labor;
    const total = alpha + beta;
    return {
      capital,
      labor,
      cost: w * labor + r * capital,
      returns: Math.abs(total - 1) < 1e-12 ? 'constant' : total > 1 ? 'increasing' : 'decreasing',
      mrts: (beta / alpha) * (capital / labor),
    };
  }
  if (p.kind === 'leontief') {
    // Q = min(K / a, L / b): a units of capital and b of labor per unit of output.
    return { capital: p.a * q, labor: p.b * q, cost: w * p.b * q + r * p.a * q, returns: 'constant', mrts: null };
  }
  // Q = a K + b L: only the cheaper input per unit of output is used.
  const useCapital = p.a / r >= p.b / w;
  return {
    capital: useCapital ? q / p.a : 0,
    labor: useCapital ? 0 : q / p.b,
    cost: useCapital ? (r * q) / p.a : (w * q) / p.b,
    returns: 'constant',
    mrts: p.b / p.a,
  };
}

export interface ShortRun {
  labor: number;
  variableCost: number;
  totalCost: number;
  marginalCost: number;
  averageVariable: number;
  averageTotal: number;
}

/** Short-run costs of Q = A K^alpha L^beta with capital fixed at K, at output Q. */
export function shortRunCosts(
  A: number,
  alpha: number,
  beta: number,
  k: number,
  w: number,
  r: number,
  q: number,
): ShortRun | null {
  if (![A, alpha, beta, k, w, r, q].every((x) => x > 0)) return null;
  const labor = (q / (A * k ** alpha)) ** (1 / beta);
  const variableCost = w * labor;
  return {
    labor,
    variableCost,
    totalCost: variableCost + r * k,
    marginalCost: (w * labor) / (beta * q),
    averageVariable: variableCost / q,
    averageTotal: (variableCost + r * k) / q,
  };
}

/** The output where price equals short-run marginal cost (decreasing returns to labor: beta below 1). */
export function firmSupply(A: number, alpha: number, beta: number, k: number, w: number, price: number): number | null {
  if (![A, alpha, beta, k, w, price].every((x) => x > 0) || beta >= 1) return null;
  const c = (A * k ** alpha) ** (-1 / beta);
  return ((beta * price) / (w * c)) ** (beta / (1 - beta));
}

export interface TwoPeriod {
  wealth: number;
  first: number;
  second: number;
  saving: number;
}

/** Two periods with utility c1^(1-theta)/(1-theta) + beta c2^(1-theta)/(1-theta) (log when theta is 1). */
export function twoPeriod(y1: number, y2: number, r: number, beta: number, theta: number): TwoPeriod | null {
  if (!(beta > 0) || !(theta > 0) || r <= -1 || y1 < 0 || y2 < 0 || y1 + y2 <= 0) return null;
  const wealth = y1 + y2 / (1 + r);
  const first = wealth / (1 + beta ** (1 / theta) * (1 + r) ** (1 / theta - 1));
  const second = (wealth - first) * (1 + r);
  return { wealth, first, second, saving: y1 - first };
}
