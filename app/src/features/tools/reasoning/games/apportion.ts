// Apportionment of seats: Hamilton's largest remainders, and the divisor methods of Jefferson (D'Hondt), Webster
// (Sainte-Laguë), Adams, and Huntington-Hill, each as a queue of priorities. Ties go to the earlier party. Parties
// under the threshold share of the total get no seats. The Alabama paradox check reruns Hamilton with 1 more seat.
import { fail } from '../core/util';

export type Method = 'hamilton' | 'jefferson' | 'webster' | 'adams' | 'hill';
export const METHODS: readonly Method[] = ['hamilton', 'jefferson', 'webster', 'adams', 'hill'];

export interface Party {
  name: string;
  size: number;
}

/** The divisor for a party that holds n seats. Zero means its first seat comes before anything else. */
const DIVISOR: Record<Exclude<Method, 'hamilton'>, (n: number) => number> = {
  jefferson: (n) => n + 1,
  webster: (n) => n + 0.5,
  adams: (n) => n,
  hill: (n) => Math.sqrt(n * (n + 1)),
};

function check(parties: readonly Party[], seats: number): void {
  if (parties.length === 0) fail('noParties');
  if (!Number.isInteger(seats) || seats < 1 || seats > 10000) fail('seatCount');
  if (parties.some((p) => !(p.size > 0))) fail('partySize');
}

/** Seats and, when the last seat went to one of several parties with equal claims, those parties by index. */
export interface Apportioned {
  seats: number[];
  tied: number[];
}

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function hamiltonFull(parties: readonly Party[], seats: number): Apportioned {
  check(parties, seats);
  const total = parties.reduce((s, p) => s + p.size, 0);
  const quotas = parties.map((p) => (p.size * seats) / total);
  const out = quotas.map(Math.floor);
  const order = quotas.map((q, i) => ({ i, r: q - Math.floor(q) })).sort((a, b) => b.r - a.r || a.i - b.i);
  const left = seats - out.reduce((s, v) => s + v, 0);
  for (let k = 0; k < left; k += 1) out[order[k % order.length].i] += 1;
  // A tie matters when the last remainder served equals the first one left out.
  const cut = left > 0 && left < order.length && same(order[left - 1].r, order[left].r) ? order[left - 1].r : null;
  const tied =
    cut === null
      ? []
      : order
          .filter((o) => same(o.r, cut))
          .map((o) => o.i)
          .sort((a, b) => a - b);
  return { seats: out, tied };
}

export const hamilton = (parties: readonly Party[], seats: number): number[] => hamiltonFull(parties, seats).seats;

function divisorFull(method: Exclude<Method, 'hamilton'>, parties: readonly Party[], seats: number): Apportioned {
  check(parties, seats);
  if (method === 'adams' || method === 'hill') if (seats < parties.length) fail('fewSeats', { n: parties.length });
  const out = parties.map(() => 0);
  const priorityOf = (i: number) => {
    const d = DIVISOR[method](out[i]);
    return d === 0 ? Infinity : parties[i].size / d;
  };
  let last = Infinity;
  const lastWinners: number[] = [];
  for (let k = 0; k < seats; k += 1) {
    let best = 0;
    let bestPriority = -1;
    parties.forEach((_, i) => {
      const priority = priorityOf(i);
      if (priority > bestPriority) {
        best = i;
        bestPriority = priority;
      }
    });
    if (!(bestPriority === last || same(bestPriority, last))) lastWinners.length = 0;
    last = bestPriority;
    lastWinners.push(best);
    out[best] += 1;
  }
  // The final seat was a coin toss if a party left out has the same priority as the last seat given.
  const losers = parties.map((_, i) => i).filter((i) => Number.isFinite(last) && same(priorityOf(i), last));
  const tied = losers.length ? [...new Set([...lastWinners, ...losers])].sort((a, b) => a - b) : [];
  return { seats: out, tied };
}

export const divisorMethod = (
  method: Exclude<Method, 'hamilton'>,
  parties: readonly Party[],
  seats: number,
): number[] => divisorFull(method, parties, seats).seats;

/** Seats by a method, with parties under the threshold left out; ties name parties by their index in `parties`. */
export function apportionFull(method: Method, parties: readonly Party[], seats: number, threshold = 0): Apportioned {
  const total = parties.reduce((s, p) => s + p.size, 0);
  const kept = parties.map((p) => (p.size * 100) / total >= threshold);
  const eligible = parties.map((_, i) => i).filter((i) => kept[i]);
  if (eligible.length === 0) fail('threshold');
  const list = eligible.map((i) => parties[i]);
  const r = method === 'hamilton' ? hamiltonFull(list, seats) : divisorFull(method, list, seats);
  const out = parties.map(() => 0);
  eligible.forEach((i, k) => (out[i] = r.seats[k]));
  return { seats: out, tied: r.tied.map((k) => eligible[k]) };
}

export const apportion = (method: Method, parties: readonly Party[], seats: number, threshold = 0): number[] =>
  apportionFull(method, parties, seats, threshold).seats;

/** The parties that lose a seat under Hamilton when the house grows by 1. */
export function alabama(parties: readonly Party[], seats: number): string[] {
  const now = hamilton(parties, seats);
  const more = hamilton(parties, seats + 1);
  return parties.filter((_, i) => more[i] < now[i]).map((p) => p.name);
}
