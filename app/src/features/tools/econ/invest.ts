// Investment mathematics as pure functions. Rates are fractions per year unless a function says otherwise.
import { brent, solveLinear } from './num';

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

// ---------- bonds ----------

export interface BondTerms {
  face: number;
  /** Coupon rate per year. */
  coupon: number;
  /** Years to maturity (a multiple of 1 / frequency). */
  years: number;
  /** Payments per year. */
  frequency: number;
}

/** Cash flows and their times in years, from the end of the first period. */
function bondFlows(b: BondTerms): { times: number[]; flows: number[] } | null {
  const n = Math.round(b.years * b.frequency);
  if (!(b.face > 0) || b.coupon < 0 || !(n >= 1) || !(b.frequency >= 1) || Math.abs(n - b.years * b.frequency) > 1e-9)
    return null;
  const times = Array.from({ length: n }, (_, i) => (i + 1) / b.frequency);
  const flows = times.map((_t, i) => (b.face * b.coupon) / b.frequency + (i === n - 1 ? b.face : 0));
  return { times, flows };
}

export function bondPrice(b: BondTerms, yieldRate: number): number | null {
  const cf = bondFlows(b);
  if (!cf || yieldRate <= -b.frequency) return null;
  return sum(cf.flows.map((c, i) => c / (1 + yieldRate / b.frequency) ** (i + 1)));
}

/** The yield (per year, compounded `frequency` times) that prices the bond at `price`. */
export function bondYield(b: BondTerms, price: number): number | null {
  if (!(price > 0) || !bondFlows(b)) return null;
  return brent((y) => (bondPrice(b, y) ?? NaN) - price, -0.99 * b.frequency + 1e-6, 5, 1e-14);
}

export interface BondRisk {
  price: number;
  macaulay: number;
  modified: number;
  convexity: number;
}

export function bondRisk(b: BondTerms, yieldRate: number): BondRisk | null {
  const cf = bondFlows(b);
  const price = bondPrice(b, yieldRate);
  if (!cf || price === null) return null;
  const y = yieldRate / b.frequency;
  const pv = cf.flows.map((c, i) => c / (1 + y) ** (i + 1));
  const macaulay = sum(pv.map((p, i) => p * cf.times[i])) / price;
  const convexity = sum(pv.map((p, i) => (p * (i + 1) * (i + 2)) / (1 + y) ** 2)) / (price * b.frequency ** 2);
  return { price, macaulay, modified: macaulay / (1 + y), convexity };
}

/** The price change for a yield change using duration and convexity (as a fraction of price). */
export const priceChange = (risk: BondRisk, dy: number): number => -risk.modified * dy + 0.5 * risk.convexity * dy * dy;

export type DayCount = '30/360' | 'act/360' | 'act/act';

const utc = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? d : null;
};
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

/** Accrued interest between the last and next coupon dates (ISO dates), from the annual coupon payment. */
export function accruedInterest(
  annualCoupon: number,
  frequency: number,
  last: string,
  settlement: string,
  next: string,
  convention: DayCount,
): { accrued: number; days: number; basis: number } | null {
  const a = utc(last);
  const s = utc(settlement);
  const n = utc(next);
  if (!a || !s || !n || !(a <= s && s <= n && a < n) || !(frequency >= 1)) return null;
  const thirty = (from: Date, to: Date) => {
    const d1 = Math.min(30, from.getUTCDate());
    const d2 = d1 === 30 ? Math.min(30, to.getUTCDate()) : to.getUTCDate();
    return (
      360 * (to.getUTCFullYear() - from.getUTCFullYear()) + 30 * (to.getUTCMonth() - from.getUTCMonth()) + (d2 - d1)
    );
  };
  if (convention === 'act/360') {
    const days = daysBetween(a, s);
    return { accrued: (annualCoupon * days) / 360, days, basis: 360 };
  }
  const days = convention === '30/360' ? thirty(a, s) : daysBetween(a, s);
  const basis = convention === '30/360' ? thirty(a, n) : daysBetween(a, n);
  return { accrued: (annualCoupon / frequency) * (days / basis), days, basis };
}

export interface BootBond {
  years: number;
  coupon: number;
  price: number;
}

/** Spot and forward rates from annual-pay bonds of consecutive maturities (face 100), shortest first. */
export function bootstrap(
  bonds: readonly BootBond[],
): { spot: number[]; forward: (number | null)[]; discount: number[] } | null {
  if (bonds.length === 0 || bonds.some((b, i) => b.years !== i + 1 || !(b.price > 0) || b.coupon < 0)) return null;
  const discount: number[] = [];
  for (const b of bonds) {
    const known = sum(discount) * b.coupon;
    const df = (b.price - known) / (100 + b.coupon);
    if (!(df > 0)) return null;
    discount.push(df);
  }
  return {
    discount,
    spot: discount.map((d, i) => d ** (-1 / (i + 1)) - 1),
    forward: discount.map((d, i) => (i === 0 ? null : discount[i - 1] / d - 1)),
  };
}

// ---------- portfolios ----------

export function mean(xs: readonly number[]): number {
  return sum(xs) / xs.length;
}
export function variance(xs: readonly number[]): number {
  const m = mean(xs);
  return sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1);
}
export function covariance(a: readonly number[], b: readonly number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  return sum(a.map((x, i) => (x - ma) * (b[i] - mb))) / (a.length - 1);
}

/** Simple returns from a price series. */
export const returnsFrom = (prices: readonly number[]): number[] => prices.slice(1).map((p, i) => p / prices[i] - 1);

export interface TwoAsset {
  weight: number;
  mean: number;
  sd: number;
}

/** The minimum-variance mix of two assets (the weight on the first), allowing short sales. */
export function twoAssetMinVariance(m1: number, m2: number, s1: number, s2: number, rho: number): TwoAsset | null {
  const denominator = s1 * s1 + s2 * s2 - 2 * rho * s1 * s2;
  if (!(s1 > 0) || !(s2 > 0) || Math.abs(rho) > 1 || !(denominator > 0)) return null;
  const weight = (s2 * s2 - rho * s1 * s2) / denominator;
  const variancePortfolio =
    weight ** 2 * s1 ** 2 + (1 - weight) ** 2 * s2 ** 2 + 2 * weight * (1 - weight) * rho * s1 * s2;
  return { weight, mean: weight * m1 + (1 - weight) * m2, sd: Math.sqrt(variancePortfolio) };
}

export interface Portfolio {
  weights: number[];
  mean: number;
  sd: number;
  sharpe: number | null;
}

export function portfolioStats(
  weights: readonly number[],
  means: readonly number[],
  cov: readonly (readonly number[])[],
  rf: number,
): Portfolio {
  const mu = sum(weights.map((w, i) => w * means[i]));
  const v = sum(weights.map((w, i) => sum(weights.map((x, j) => w * x * cov[i][j]))));
  const sd = Math.sqrt(Math.max(0, v));
  return { weights: [...weights], mean: mu, sd, sharpe: sd > 0 ? (mu - rf) / sd : null };
}

/** Covariance matrix from standard deviations and a correlation matrix; null when the shapes disagree. */
export function covarianceFrom(sds: readonly number[], corr: readonly (readonly number[])[]): number[][] | null {
  const n = sds.length;
  if (n < 2 || corr.length !== n || corr.some((row, i) => row.length !== n || Math.abs(row[i] - 1) > 1e-9)) return null;
  for (let i = 0; i < n; i += 1)
    for (let j = 0; j < n; j += 1)
      if (Math.abs(corr[i][j] - corr[j][i]) > 1e-9 || Math.abs(corr[i][j]) > 1 + 1e-9) return null;
  return sds.map((s, i) => sds.map((t, j) => s * t * corr[i][j]));
}

/** The global minimum-variance portfolio, short sales allowed. */
export function minimumVariance(
  means: readonly number[],
  cov: readonly (readonly number[])[],
  rf = 0,
): Portfolio | null {
  const x = solveLinear(
    cov,
    means.map(() => 1),
  );
  if (!x) return null;
  const total = sum(x);
  return total === 0
    ? null
    : portfolioStats(
        x.map((v) => v / total),
        means,
        cov,
        rf,
      );
}

/** The tangency (maximum Sharpe) portfolio, short sales allowed. */
export function tangency(means: readonly number[], cov: readonly (readonly number[])[], rf: number): Portfolio | null {
  const x = solveLinear(
    cov,
    means.map((m) => m - rf),
  );
  if (!x) return null;
  const total = sum(x);
  return Math.abs(total) < 1e-12
    ? null
    : portfolioStats(
        x.map((v) => v / total),
        means,
        cov,
        rf,
      );
}

export interface Capm {
  beta: number;
  alpha: number;
  rSquared: number;
  expected: number;
}

/** Beta by regression of asset returns on market returns (excess over a per-period risk-free rate). */
export function capm(asset: readonly number[], market: readonly number[], rf: number): Capm | null {
  if (asset.length !== market.length || asset.length < 3) return null;
  const vm = variance(market);
  if (!(vm > 0)) return null;
  const a = asset.map((x) => x - rf);
  const m = market.map((x) => x - rf);
  const beta = covariance(a, m) / variance(m);
  const alpha = mean(a) - beta * mean(m);
  const va = variance(a);
  const r = va > 0 ? covariance(a, m) / Math.sqrt(va * variance(m)) : 0;
  return { beta, alpha, rSquared: r * r, expected: rf + beta * mean(m) };
}

// ---------- options ----------

/** The standard normal distribution function, accurate to about 1e-15. */
export function normalCdf(x: number): number {
  if (x < -9) return 0;
  if (x > 9) return 1;
  const z = Math.abs(x) / Math.SQRT2;
  let erf: number;
  if (z < 5) {
    let term = z;
    let total = z;
    for (let n = 1; n < 200; n += 1) {
      term *= (2 * z * z) / (2 * n + 1);
      total += term;
      if (term < total * 1e-17) break;
    }
    erf = (2 / Math.sqrt(Math.PI)) * Math.exp(-z * z) * total;
  } else erf = 1;
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
export const normalPdf = (x: number): number => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);

export interface OptionInputs {
  spot: number;
  strike: number;
  rate: number;
  vol: number;
  time: number;
  dividend: number;
}
export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  rho: number;
}

export function blackScholes(o: OptionInputs, kind: 'call' | 'put'): Greeks | null {
  const { spot: S, strike: K, rate: r, vol: s, time: T, dividend: q } = o;
  if (!(S > 0) || !(K > 0) || !(s > 0) || !(T > 0)) return null;
  const sq = s * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (s * s) / 2) * T) / sq;
  const d2 = d1 - sq;
  const df = Math.exp(-r * T);
  const dq = Math.exp(-q * T);
  const call = kind === 'call';
  const price = call
    ? S * dq * normalCdf(d1) - K * df * normalCdf(d2)
    : K * df * normalCdf(-d2) - S * dq * normalCdf(-d1);
  const delta = call ? dq * normalCdf(d1) : -dq * normalCdf(-d1);
  const gamma = (dq * normalPdf(d1)) / (S * sq);
  const vega = S * dq * normalPdf(d1) * Math.sqrt(T);
  const decay = -(S * dq * normalPdf(d1) * s) / (2 * Math.sqrt(T));
  const theta = call
    ? decay - r * K * df * normalCdf(d2) + q * S * dq * normalCdf(d1)
    : decay + r * K * df * normalCdf(-d2) - q * S * dq * normalCdf(-d1);
  const rho = call ? K * T * df * normalCdf(d2) : -K * T * df * normalCdf(-d2);
  return { price, delta, gamma, vega, theta, rho };
}

/** The volatility that gives the market price, or null when none exists. */
export function impliedVolatility(o: Omit<OptionInputs, 'vol'>, kind: 'call' | 'put', price: number): number | null {
  const f = (v: number) => (blackScholes({ ...o, vol: v }, kind)?.price ?? NaN) - price;
  return brent(f, 1e-6, 10, 1e-12);
}

export interface Binomial {
  price: number;
  up: number;
  down: number;
  probability: number;
  tree: number[][];
}

/** A Cox-Ross-Rubinstein tree; tree[t][j] is the option value after t steps and j up moves. */
export function binomialTree(o: OptionInputs, kind: 'call' | 'put', steps: number, american: boolean): Binomial | null {
  const { spot: S, strike: K, rate: r, vol: s, time: T, dividend: q } = o;
  if (!(S > 0) || !(K > 0) || !(s > 0) || !(T > 0) || !Number.isInteger(steps) || steps < 1 || steps > 1000)
    return null;
  const dt = T / steps;
  const up = Math.exp(s * Math.sqrt(dt));
  const down = 1 / up;
  const probability = (Math.exp((r - q) * dt) - down) / (up - down);
  if (!(probability > 0 && probability < 1)) return null;
  const df = Math.exp(-r * dt);
  const payoff = (price: number) => Math.max(0, kind === 'call' ? price - K : K - price);
  const tree: number[][] = Array.from({ length: steps + 1 }, () => []);
  for (let j = 0; j <= steps; j += 1) tree[steps][j] = payoff(S * up ** j * down ** (steps - j));
  for (let t = steps - 1; t >= 0; t -= 1) {
    for (let j = 0; j <= t; j += 1) {
      const held = df * (probability * tree[t + 1][j + 1] + (1 - probability) * tree[t + 1][j]);
      tree[t][j] = american ? Math.max(held, payoff(S * up ** j * down ** (t - j))) : held;
    }
  }
  return { price: tree[0][0], up, down, probability, tree };
}

export interface Leg {
  kind: 'call' | 'put' | 'stock';
  strike: number;
  /** Positive for long, negative for short. */
  quantity: number;
  /** The premium paid per unit (or stock price). */
  premium: number;
}

export function legPayoff(leg: Leg, price: number): number {
  const intrinsic =
    leg.kind === 'call'
      ? Math.max(0, price - leg.strike)
      : leg.kind === 'put'
        ? Math.max(0, leg.strike - price)
        : price;
  return leg.quantity * intrinsic;
}

/** Profit of a combination at expiry, and the prices where profit crosses zero. */
export function strategy(
  legs: readonly Leg[],
  low: number,
  high: number,
): { profitAt: (s: number) => number; breakEvens: number[]; maxProfit: number; maxLoss: number } {
  const profitAt = (s: number) => sum(legs.map((l) => legPayoff(l, s) - l.quantity * l.premium));
  const kinks = [...new Set(legs.filter((l) => l.kind !== 'stock').map((l) => l.strike))].sort((a, b) => a - b);
  const points = [low, ...kinks.filter((k) => k > low && k < high), high];
  const breakEvens: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const fa = profitAt(a);
    const fb = profitAt(b);
    if (fa === 0) breakEvens.push(a);
    else if (fa * fb < 0) breakEvens.push(a - (fa * (b - a)) / (fb - fa));
  }
  if (profitAt(high) === 0) breakEvens.push(high);
  const values = points.map(profitAt);
  return {
    profitAt,
    breakEvens: [...new Set(breakEvens.map((x) => Math.round(x * 1e9) / 1e9))],
    maxProfit: Math.max(...values),
    maxLoss: Math.min(...values),
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Geometric Brownian motion paths from a seed; each path has steps + 1 prices. */
export function gbmPaths(
  spot: number,
  drift: number,
  vol: number,
  time: number,
  steps: number,
  count: number,
  seed: number,
): number[][] {
  const random = mulberry32(seed);
  const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const dt = time / steps;
  return Array.from({ length: count }, () => {
    const path = [spot];
    for (let i = 0; i < steps; i += 1)
      path.push(path[i] * Math.exp((drift - (vol * vol) / 2) * dt + vol * Math.sqrt(dt) * normal()));
    return path;
  });
}

// ---------- valuation ----------

export const wacc = (equity: number, debt: number, costEquity: number, costDebt: number, tax: number): number | null =>
  equity + debt > 0 ? (equity / (equity + debt)) * costEquity + (debt / (equity + debt)) * costDebt * (1 - tax) : null;

/** The cost of equity from CAPM. */
export const costOfEquity = (rf: number, beta: number, marketPremium: number): number => rf + beta * marketPremium;

/** The Gordon growth value of a payment next year that grows at g forever; null unless the rate exceeds g. */
export const gordon = (next: number, rate: number, growth: number): number | null =>
  rate > growth ? next / (rate - growth) : null;

export interface Dcf {
  pvFlows: number;
  terminal: number;
  pvTerminal: number;
  value: number;
}

/** Present value of explicit flows (end of each year) plus a terminal value at the last year. */
export function dcf(
  flows: readonly number[],
  rate: number,
  terminal: { kind: 'growth'; growth: number } | { kind: 'multiple'; multiple: number; metric: number },
): Dcf | null {
  if (flows.length < 1 || rate <= -1) return null;
  const last = flows[flows.length - 1];
  const tv =
    terminal.kind === 'growth'
      ? gordon(last * (1 + terminal.growth), rate, terminal.growth)
      : terminal.multiple * terminal.metric;
  if (tv === null) return null;
  const pvFlows = sum(flows.map((f, i) => f / (1 + rate) ** (i + 1)));
  const pvTerminal = tv / (1 + rate) ** flows.length;
  return { pvFlows, terminal: tv, pvTerminal, value: pvFlows + pvTerminal };
}

// ---------- startup finance ----------

export interface Round {
  investment: number;
  preMoney: number;
}

export function postMoney(r: Round): { post: number; ownership: number } {
  return { post: r.preMoney + r.investment, ownership: r.investment / (r.preMoney + r.investment) };
}

/** Ownership of the original holders after each round, assuming no new shares other than the investors'. */
export function dilution(rounds: readonly Round[]): number[] {
  const out: number[] = [];
  let share = 1;
  for (const r of rounds) {
    share *= 1 - postMoney(r).ownership;
    out.push(share);
  }
  return out;
}

export interface PoolShuffle {
  shares: number;
  investorShares: number;
  poolShares: number;
  price: number;
  preMoneyEffective: number;
}

/** A round where the option pool (a share of the post-money company) is created before the investment. */
export function poolShuffle(
  existingShares: number,
  investment: number,
  postMoneyValue: number,
  pool: number,
): PoolShuffle | null {
  const investor = investment / postMoneyValue;
  if (!(existingShares > 0) || !(investor > 0) || pool < 0 || investor + pool >= 1) return null;
  const shares = existingShares / (1 - investor - pool);
  return {
    shares,
    investorShares: shares * investor,
    poolShares: shares * pool,
    price: investment / (shares * investor),
    preMoneyEffective: postMoneyValue - investment - (shares * pool * investment) / (shares * investor),
  };
}

export interface Safe {
  capPrice: number;
  discountPrice: number;
  price: number;
  shares: number;
  basis: 'cap' | 'discount' | 'round';
}

/** Conversion of the note at the round, at the lowest of the cap price, the discount price, and the round price. */
export function safeConversion(
  amount: number,
  preMoneyShares: number,
  roundPrice: number,
  cap: number | null,
  discount: number,
): Safe | null {
  if (!(amount > 0) || !(preMoneyShares > 0) || !(roundPrice > 0) || discount < 0 || discount >= 1) return null;
  const capPrice = cap !== null ? cap / preMoneyShares : Infinity;
  const discountPrice = roundPrice * (1 - discount);
  const price = Math.min(capPrice, discountPrice, roundPrice);
  return {
    capPrice,
    discountPrice,
    price,
    shares: amount / price,
    basis: price === capPrice ? 'cap' : price === discountPrice && discount > 0 ? 'discount' : 'round',
  };
}

/** The venture capital method: today's post-money value and the ownership an investor needs for a target return. */
export function ventureMethod(
  exitValue: number,
  years: number,
  targetReturn: number,
  investment: number,
): { post: number; ownership: number; pre: number } | null {
  if (!(exitValue > 0) || !(years > 0) || !(targetReturn > -1) || !(investment > 0)) return null;
  const post = exitValue / (1 + targetReturn) ** years;
  return { post, ownership: investment / post, pre: post - investment };
}
