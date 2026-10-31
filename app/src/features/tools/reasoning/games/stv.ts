// The single transferable vote for several seats, with the Droop quota and fractional (Gregory) transfers: when a
// candidate passes the quota, every ballot counting for them moves on at the surplus fraction of its weight. When
// nobody reaches the quota, the last-placed candidate drops out. Weights are exact fractions.
import { ZERO, add, cmp, div, frac, fracText, mul, sub, toNumber } from '../core/frac';
import type { Frac } from '../core/frac';
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail } from '../core/util';
import type { Profile } from './voting';

export interface StvResult {
  quota: number;
  elected: string[];
  rounds: { tally: Map<string, Frac>; action: string }[];
  steps: Step[];
  /** Rounds where the candidate elected or dropped was tied with others; the earlier-listed candidate goes first. */
  ties: { round: number; names: string[]; name: string; elect: boolean }[];
}

export function stv(p: Profile, seats: number): StvResult {
  if (!Number.isInteger(seats) || seats < 1 || seats >= p.candidates.length)
    fail('seatsRange', { max: p.candidates.length - 1 });
  const quota = Math.floor(p.voters / (seats + 1)) + 1;
  const q = frac(quota);
  const ballots = p.groups.map((g) => ({ ranking: g.ranking, weight: frac(g.count) }));
  let continuing = [...p.candidates];
  const elected: string[] = [];
  const rounds: StvResult['rounds'] = [];
  const steps: Step[] = [step('quota', { voters: p.voters, seats, quota })];
  const ties: StvResult['ties'] = [];
  const tiedWith = (tally: Map<string, Frac>, v: Frac) => [...tally].filter(([, x]) => cmp(x, v) === 0).map(([c]) => c);
  const topOf = (b: { ranking: string[] }) => b.ranking.find((c) => continuing.includes(c));
  for (let guard = 0; elected.length < seats && guard < 100; guard += 1) {
    if (continuing.length <= seats - elected.length) {
      elected.push(...continuing);
      steps.push(step('stvFill', { names: continuing.join(', ') }));
      break;
    }
    const tally = new Map<string, Frac>(continuing.map((c) => [c, ZERO]));
    for (const b of ballots) {
      const top = topOf(b);
      if (top) tally.set(top, add(tally.get(top)!, b.weight));
    }
    const shown = [...tally].map(([c, v]) => `${c} ${fmt(v)}`).join(', ');
    const best = [...tally].sort((a, b) => cmp(b[1], a[1]))[0];
    if (cmp(best[1], q) >= 0) {
      const [winner, votes] = best;
      const surplus = sub(votes, q);
      const ratio = div(surplus, votes);
      for (const b of ballots) if (topOf(b) === winner) b.weight = mul(b.weight, ratio);
      const level = tiedWith(tally, votes);
      if (level.length > 1) ties.push({ round: rounds.length + 1, names: level, name: winner, elect: true });
      elected.push(winner);
      continuing = continuing.filter((c) => c !== winner);
      rounds.push({ tally, action: winner });
      const at = { round: rounds.length, tally: shown, name: winner };
      steps.push(
        surplus.n === 0n
          ? step('stvExact', at)
          : step('stvElect', { ...at, surplus: fmt(surplus), ratio: fracText(ratio) }),
      );
    } else {
      const [low, lowVotes] = [...tally].sort((a, b) => cmp(a[1], b[1]))[0];
      const level = tiedWith(tally, lowVotes);
      if (level.length > 1) ties.push({ round: rounds.length + 1, names: level, name: low, elect: false });
      continuing = continuing.filter((c) => c !== low);
      rounds.push({ tally, action: low });
      steps.push(step('stvDrop', { round: rounds.length, tally: shown, name: low }));
    }
  }
  return { quota, elected, rounds, steps, ties };
}

/** A weight as a decimal with up to 3 places. */
const fmt = (v: Frac): string => String(Math.round(toNumber(v) * 1000) / 1000);
