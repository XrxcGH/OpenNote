// Market power: monopoly, price discrimination, Cournot, Bertrand, Stackelberg, collusion, and concentration.
// Demand is linear, P = a - bQ, and marginal costs are constant, unless a function says otherwise.
import { solveLinear } from './num';

export interface Monopoly {
  quantity: number;
  price: number;
  profit: number;
  deadweightLoss: number;
  lerner: number;
  elasticity: number;
}

/** A monopolist facing P = a - bQ with constant marginal cost c and a fixed cost; null when it would not produce. */
export function monopoly(a: number, b: number, c: number, fixed = 0): Monopoly | null {
  if (!(b > 0) || !(a > c)) return null;
  const quantity = (a - c) / (2 * b);
  const price = (a + c) / 2;
  return {
    quantity,
    price,
    profit: (price - c) * quantity - fixed,
    deadweightLoss: ((a - c) * (a - c)) / (8 * b),
    lerner: (price - c) / price,
    elasticity: price / (b * quantity),
  };
}

/** First-degree discrimination: every unit sold at the buyer's value, so output is efficient and profit is the surplus. */
export function perfectDiscrimination(a: number, b: number, c: number): { quantity: number; profit: number } | null {
  if (!(b > 0) || !(a > c)) return null;
  return { quantity: (a - c) / b, profit: ((a - c) * (a - c)) / (2 * b) };
}

export interface Market {
  a: number;
  b: number;
}

export interface Discrimination {
  prices: number[];
  quantities: number[];
  profit: number;
  uniformPrice: number;
  uniformProfit: number;
}

/** Third-degree discrimination across markets with demand P = a_i - b_i Q_i, against the best single price. */
export function thirdDegree(markets: readonly Market[], c: number): Discrimination | null {
  if (markets.some((m) => !(m.b > 0)) || !markets.some((m) => m.a > c)) return null;
  const prices = markets.map((m) => (m.a > c ? (m.a + c) / 2 : m.a));
  const quantities = markets.map((m, i) => Math.max(0, (m.a - prices[i]) / m.b));
  const profit = markets.reduce((sum, _m, i) => sum + (prices[i] - c) * quantities[i], 0);
  const demand = (p: number) => markets.reduce((sum, m) => sum + Math.max(0, (m.a - p) / m.b), 0);
  const candidates = [c, ...markets.map((m) => m.a)];
  for (let mask = 1; mask < 1 << markets.length; mask += 1) {
    const set = markets.filter((_m, i) => mask & (1 << i));
    const A = set.reduce((s, m) => s + m.a / m.b, 0);
    const B = set.reduce((s, m) => s + 1 / m.b, 0);
    candidates.push((A / B + c) / 2);
  }
  let best = { price: c, profit: -Infinity };
  for (const p of candidates) {
    const value = (p - c) * demand(p);
    if (p >= c && value > best.profit + 1e-12) best = { price: p, profit: value };
  }
  return { prices, quantities, profit, uniformPrice: best.price, uniformProfit: best.profit };
}

export interface Cournot {
  quantities: number[];
  total: number;
  price: number;
  profits: number[];
}

/** Cournot equilibrium with n firms and constant marginal costs; a firm that would produce nothing drops out. */
export function cournot(a: number, b: number, costs: readonly number[]): Cournot | null {
  if (!(b > 0) || costs.length < 1) return null;
  let active = costs.map((_c, i) => i);
  let q: number[] = [];
  for (let round = 0; round <= costs.length && active.length > 0; round += 1) {
    const k = active.length;
    const matrix = active.map((_i, r) => active.map((_j, s) => (r === s ? 2 * b : b)));
    const sol = solveLinear(
      matrix,
      active.map((i) => a - costs[i]),
    );
    if (!sol) return null;
    const keep = active.filter((_i, r) => sol[r] > 1e-12);
    if (keep.length === k) {
      q = costs.map(() => 0);
      active.forEach((i, r) => (q[i] = sol[r]));
      break;
    }
    active = keep;
  }
  if (q.length === 0) return null;
  const total = q.reduce((s, x) => s + x, 0);
  const price = a - b * total;
  return { quantities: q, total, price, profits: q.map((x, i) => (price - costs[i]) * x) };
}

export interface Stackelberg {
  leader: number;
  follower: number;
  price: number;
  leaderProfit: number;
  followerProfit: number;
}

/** A leader who commits to a quantity and a follower who best-responds; null when the leader would not produce. */
export function stackelberg(a: number, b: number, leaderCost: number, followerCost: number): Stackelberg | null {
  if (!(b > 0)) return null;
  const leader = (a - 2 * leaderCost + followerCost) / (2 * b);
  if (leader <= 0) return null;
  const follower = Math.max(0, (a - followerCost - b * leader) / (2 * b));
  const price = a - b * (leader + follower);
  return {
    leader,
    follower,
    price,
    leaderProfit: (price - leaderCost) * leader,
    followerProfit: (price - followerCost) * follower,
  };
}

export const bestResponse = (a: number, b: number, c: number, others: number): number =>
  Math.max(0, (a - c - b * others) / (2 * b));

export interface Bertrand {
  prices: number[];
  profits: number[];
}

/** Bertrand with identical goods: the cheapest firm takes the market at just under the next cost (capped at the
 * monopoly price); with equal costs price equals cost. */
export function bertrandHomogeneous(a: number, b: number, costs: readonly number[]): Bertrand | null {
  const sorted = [...costs].sort((x, y) => x - y);
  if (!(b > 0) || sorted.length < 2 || !(a > sorted[0])) return null;
  const low = sorted[0];
  const next = sorted[1];
  const monopolyPrice = (a + low) / 2;
  const price = low === next ? low : Math.min(next, monopolyPrice);
  const quantity = Math.max(0, (a - price) / b);
  const winners = costs.filter((c) => c === low).length;
  return {
    prices: costs.map((c) => (c === low ? price : Math.max(c, price))),
    profits: costs.map((c) => (c === low ? ((price - c) * quantity) / winners : 0)),
  };
}

/** Bertrand with differentiated goods: q_i = alpha_i - beta p_i + gamma p_j, solved from the two best responses. */
export function bertrandDifferentiated(
  alpha: readonly [number, number],
  beta: number,
  gamma: number,
  costs: readonly [number, number],
): { prices: [number, number]; quantities: [number, number]; profits: [number, number] } | null {
  if (!(beta > 0) || !(Math.abs(gamma) < beta)) return null;
  // p_i = (alpha_i + beta c_i + gamma p_j) / (2 beta)
  const sol = solveLinear(
    [
      [2 * beta, -gamma],
      [-gamma, 2 * beta],
    ],
    [alpha[0] + beta * costs[0], alpha[1] + beta * costs[1]],
  );
  if (!sol) return null;
  const q: [number, number] = [alpha[0] - beta * sol[0] + gamma * sol[1], alpha[1] - beta * sol[1] + gamma * sol[0]];
  if (q[0] < 0 || q[1] < 0) return null;
  return {
    prices: [sol[0], sol[1]],
    quantities: q,
    profits: [(sol[0] - costs[0]) * q[0], (sol[1] - costs[1]) * q[1]],
  };
}

export interface Collusion {
  collusiveProfit: number;
  deviationProfit: number;
  nashProfit: number;
  /** The lowest discount factor at which a grim-trigger agreement holds. */
  criticalDiscount: number;
}

/** A cartel of n identical firms against deviation and Cournot reversion. */
export function collusion(a: number, b: number, c: number, n: number): Collusion | null {
  const m = monopoly(a, b, c);
  if (!m || !(n >= 2) || !Number.isInteger(n)) return null;
  const share = m.quantity / n;
  const collusiveProfit = m.profit / n;
  const deviate = bestResponse(a, b, c, share * (n - 1));
  const price = a - b * (deviate + share * (n - 1));
  const deviationProfit = (price - c) * deviate;
  const nashQ = (a - c) / (b * (n + 1));
  const nashProfit = ((a - c) * (a - c)) / (b * (n + 1) * (n + 1));
  void nashQ;
  return {
    collusiveProfit,
    deviationProfit,
    nashProfit,
    criticalDiscount: (deviationProfit - collusiveProfit) / (deviationProfit - nashProfit),
  };
}

export interface Concentration {
  hhi: number;
  cr4: number;
  shares: number[];
}

/** Shares in percent, scaled to sum to 100 when they do not. */
export function concentration(shares: readonly number[]): Concentration | null {
  if (shares.length === 0 || shares.some((s) => s < 0)) return null;
  const total = shares.reduce((s, x) => s + x, 0);
  if (!(total > 0)) return null;
  const scaled = shares.map((s) => (s * 100) / total);
  const sorted = [...scaled].sort((x, y) => y - x);
  return {
    hhi: scaled.reduce((s, x) => s + x * x, 0),
    cr4: sorted.slice(0, 4).reduce((s, x) => s + x, 0),
    shares: scaled,
  };
}

/** The change in HHI when two firms (by position) merge: twice the product of their shares. */
export function mergerChange(shares: readonly number[], i: number, j: number): number | null {
  const scaled = concentration(shares)?.shares;
  return scaled && i !== j && scaled[i] !== undefined && scaled[j] !== undefined ? 2 * scaled[i] * scaled[j] : null;
}
