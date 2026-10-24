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

export function hamilton(parties: readonly Party[], seats: number): number[] {
  check(parties, seats);
  const total = parties.reduce((s, p) => s + p.size, 0);
  const quotas = parties.map((p) => (p.size * seats) / total);
  const out = quotas.map(Math.floor);
  const order = quotas.map((q, i) => ({ i, r: q - Math.floor(q) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; out.reduce((s, v) => s + v, 0) < seats; k += 1) out[order[k % order.length].i] += 1;
  return out;
}

export function divisorMethod(method: Exclude<Method, 'hamilton'>, parties: readonly Party[], seats: number): number[] {
  check(parties, seats);
  if (method === 'adams' || method === 'hill') if (seats < parties.length) fail('fewSeats', { n: parties.length });
  const out = parties.map(() => 0);
  for (let k = 0; k < seats; k += 1) {
    let best = 0;
    let bestPriority = -1;
    parties.forEach((p, i) => {
      const d = DIVISOR[method](out[i]);
      const priority = d === 0 ? Infinity : p.size / d;
      if (priority > bestPriority) {
        best = i;
        bestPriority = priority;
      }
    });
    out[best] += 1;
  }
  return out;
}

export function apportion(method: Method, parties: readonly Party[], seats: number, threshold = 0): number[] {
  const total = parties.reduce((s, p) => s + p.size, 0);
  const kept = parties.map((p) => (p.size * 100) / total >= threshold);
  const eligible = parties.filter((_, i) => kept[i]);
  if (eligible.length === 0) fail('threshold');
  const seatsOf = method === 'hamilton' ? hamilton(eligible, seats) : divisorMethod(method, eligible, seats);
  let k = 0;
  return parties.map((_, i) => (kept[i] ? seatsOf[k++] : 0));
}

/** The parties that lose a seat under Hamilton when the house grows by 1. */
export function alabama(parties: readonly Party[], seats: number): string[] {
  const now = hamilton(parties, seats);
  const more = hamilton(parties, seats + 1);
  return parties.filter((_, i) => more[i] < now[i]).map((p) => p.name);
}
