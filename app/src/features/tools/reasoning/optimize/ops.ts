// Operations formulas: the M/M/c queue (Erlang C) with Little's law, and the newsvendor order for normal demand.
import { normalQuantile } from '../../subjects/stats/distributions/continuous';
import { fail } from '../core/util';

export interface Queue {
  /** Offered load a = lambda / mu, and utilization rho = a / c. */
  a: number;
  rho: number;
  p0: number;
  /** The chance an arrival waits (Erlang C). */
  pWait: number;
  lq: number;
  wq: number;
  w: number;
  l: number;
}

export function mmc(lambda: number, mu: number, c: number): Queue {
  if (!(lambda > 0) || !(mu > 0)) fail('qRates');
  if (!Number.isInteger(c) || c < 1) fail('qServers');
  if (c > 500) fail('qTooMany', { count: 500 });
  const a = lambda / mu;
  const rho = a / c;
  if (rho >= 1) fail('qUnstable', { rho: Number(rho.toFixed(4)) });
  // Terms a^k / k! built one from the last, so large c does not overflow.
  let term = 1;
  let head = 1;
  for (let k = 1; k < c; k += 1) {
    term *= a / k;
    head += term;
  }
  const last = (term * a) / c; // a^c / c!
  const tail = last / (1 - rho);
  const p0 = 1 / (head + tail);
  const pWait = tail * p0;
  const lq = (pWait * rho) / (1 - rho);
  const wq = lq / lambda;
  const w = wq + 1 / mu;
  return { a, rho, p0, pWait, lq, wq, w, l: lambda * w };
}

export interface Newsvendor {
  ratio: number;
  z: number;
  q: number;
}

/** The order that balances underage cost cu and overage cost co: F(Q) = cu / (cu + co). */
export function newsvendor(cu: number, co: number, mean: number, sd: number): Newsvendor {
  if (!(cu > 0) || !(co > 0)) fail('nvCosts');
  if (!(sd > 0)) fail('nvSpread');
  const ratio = cu / (cu + co);
  const z = normalQuantile(ratio);
  return { ratio, z, q: mean + z * sd };
}
