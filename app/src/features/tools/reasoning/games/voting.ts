// Elections from ranked ballots: plurality, top-2 runoff, instant runoff, Borda, Condorcet, Copeland, Schulze, and
// approval of the top k, with the pairwise matrix, each round, and what happens when a candidate drops out. A ballot
// may rank only some candidates; those it leaves out tie below the ones it ranks.
//
// One group of ballots per line: "4: A > B > C" (4 voters), or "A > B > C" for 1.
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail, lines } from '../core/util';

export interface Ballots {
  count: number;
  ranking: string[];
}

export interface Profile {
  groups: Ballots[];
  candidates: string[];
  voters: number;
}

export function parseProfile(text: string): Profile {
  const groups = lines(text).map((line, i) => {
    const m = /^(?:(\d+)\s*[:x×*]?\s+|(\d+)\s*:\s*)?(.+)$/.exec(line);
    const count = Number(m?.[1] ?? m?.[2] ?? 1);
    const ranking = (m?.[3] ?? '')
      .split(/\s*[>,]\s*/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (!m || ranking.length === 0 || !Number.isSafeInteger(count) || count < 1) fail('ballotLine', { line: i + 1 });
    if (new Set(ranking).size !== ranking.length) fail('ballotTwice', { line: i + 1 });
    for (const c of ranking) if (!/^[\w.-]+$/.test(c)) fail('candidateName', { name: c });
    return { count, ranking };
  });
  if (groups.length === 0) fail('noBallots');
  const candidates = [...new Set(groups.flatMap((g) => g.ranking))];
  if (candidates.length < 2) fail('fewCandidates');
  if (candidates.length > 20) fail('manyCandidates');
  return { groups, candidates, voters: groups.reduce((s, g) => s + g.count, 0) };
}

/** First choices among the continuing candidates. */
export function firstChoices(p: Profile, continuing: readonly string[]): Map<string, number> {
  const tally = new Map(continuing.map((c) => [c, 0]));
  for (const g of p.groups) {
    const top = g.ranking.find((c) => continuing.includes(c));
    if (top) tally.set(top, tally.get(top)! + g.count);
  }
  return tally;
}

const leaders = (tally: Map<string, number>): string[] => {
  const top = Math.max(...tally.values());
  return [...tally].filter(([, v]) => v === top).map(([c]) => c);
};

export const plurality = (p: Profile): { tally: Map<string, number>; winners: string[] } => {
  const tally = firstChoices(p, p.candidates);
  return { tally, winners: leaders(tally) };
};

/** Instant runoff: drop the last-placed candidate until one has more than half of the ballots still counting. */
export function instantRunoff(p: Profile): { winners: string[]; rounds: Map<string, number>[]; steps: Step[] } {
  let continuing = [...p.candidates];
  const rounds: Map<string, number>[] = [];
  const steps: Step[] = [];
  for (;;) {
    const tally = firstChoices(p, continuing);
    rounds.push(tally);
    const counting = [...tally.values()].reduce((s, v) => s + v, 0);
    const top = leaders(tally);
    const shown = [...tally].map(([c, v]) => `${c} ${v}`).join(', ');
    if (tally.get(top[0])! * 2 > counting || continuing.length <= top.length) {
      steps.push(step('irvWin', { round: rounds.length, tally: shown, winner: top.join(', ') }));
      return { winners: top, rounds, steps };
    }
    const low = Math.min(...tally.values());
    const out = [...tally].filter(([, v]) => v === low).map(([c]) => c);
    // Ties for last drop together unless that would leave nobody.
    const dropped = out.length === continuing.length ? out.slice(0, 1) : out;
    steps.push(step('irvDrop', { round: rounds.length, tally: shown, out: dropped.join(', ') }));
    continuing = continuing.filter((c) => !dropped.includes(c));
  }
}

/** Top-2 runoff: more than half of the first choices wins outright; otherwise the top 2 meet head to head. */
export function runoff(p: Profile): { winners: string[]; finalists: string[] } {
  const tally = firstChoices(p, p.candidates);
  const sorted = [...tally].sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] * 2 > p.voters) return { winners: [sorted[0][0]], finalists: [sorted[0][0]] };
  const finalists = sorted.slice(0, 2).map(([c]) => c);
  const head = firstChoices(p, finalists);
  return { winners: leaders(head), finalists };
}

/** Borda: with m candidates, a ballot gives m - 1 points to its first choice, down to 0; unranked candidates get 0. */
export function borda(p: Profile): Map<string, number> {
  const m = p.candidates.length;
  const score = new Map(p.candidates.map((c) => [c, 0]));
  for (const g of p.groups) g.ranking.forEach((c, i) => score.set(c, score.get(c)! + g.count * (m - 1 - i)));
  return score;
}

/** d[x][y]: how many voters rank candidate x above candidate y. */
export function pairwise(p: Profile): number[][] {
  const n = p.candidates.length;
  const d = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (const g of p.groups) {
    const pos = (c: string) => {
      const at = g.ranking.indexOf(c);
      return at < 0 ? Infinity : at;
    };
    for (let a = 0; a < n; a += 1)
      for (let b = 0; b < n; b += 1) if (a !== b && pos(p.candidates[a]) < pos(p.candidates[b])) d[a][b] += g.count;
  }
  return d;
}

export function condorcet(p: Profile, d: number[][]): { winner: string | null; loser: string | null } {
  const n = p.candidates.length;
  const beatsAll = (a: number) => Array.from({ length: n }, (_, b) => b).every((b) => b === a || d[a][b] > d[b][a]);
  const losesAll = (a: number) => Array.from({ length: n }, (_, b) => b).every((b) => b === a || d[a][b] < d[b][a]);
  const w = p.candidates.findIndex((_, a) => beatsAll(a));
  const l = p.candidates.findIndex((_, a) => losesAll(a));
  return { winner: w >= 0 ? p.candidates[w] : null, loser: l >= 0 ? p.candidates[l] : null };
}

/** Copeland: a point for each head-to-head win and half a point for each tie. */
export function copeland(p: Profile, d: number[][]): Map<string, number> {
  return new Map(
    p.candidates.map((c, a) => [
      c,
      p.candidates.reduce((s, _, b) => (b === a ? s : s + (d[a][b] > d[b][a] ? 1 : d[a][b] === d[b][a] ? 0.5 : 0)), 0),
    ]),
  );
}

/** Schulze: the strength of the strongest path between each pair, by a widest-path Floyd-Warshall. */
export function schulze(p: Profile, d: number[][]): { strength: number[][]; winners: string[] } {
  const n = p.candidates.length;
  const s = d.map((row, a) => row.map((v, b) => (a !== b && v > d[b][a] ? v : 0)));
  for (let k = 0; k < n; k += 1)
    for (let a = 0; a < n; a += 1)
      for (let b = 0; b < n; b += 1)
        if (a !== b && a !== k && b !== k) s[a][b] = Math.max(s[a][b], Math.min(s[a][k], s[k][b]));
  const winners = p.candidates.filter((_, a) => s[a].every((v, b) => b === a || v >= s[b][a]));
  return { strength: s, winners };
}

/** Approval if each voter approves their top k. */
export function approval(p: Profile, k: number): Map<string, number> {
  const score = new Map(p.candidates.map((c) => [c, 0]));
  for (const g of p.groups) g.ranking.slice(0, k).forEach((c) => score.set(c, score.get(c)! + g.count));
  return score;
}

/** The plurality winner with each candidate removed in turn: a change of winner shows a spoiler. */
export function spoilers(p: Profile): { removed: string; winners: string[] }[] {
  return p.candidates.map((removed) => {
    const rest = p.candidates.filter((c) => c !== removed);
    return { removed, winners: leaders(firstChoices(p, rest)) };
  });
}

export const winnersOf = (score: Map<string, number>): string[] => leaders(score);
