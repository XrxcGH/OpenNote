// Word lists and corpus measures: frequencies, type-token ratios, n-grams, a keyword-in-context concordance,
// collocations in a window (mutual information, t-score, log-likelihood), and keyness of one text against
// another (log-likelihood on the 2 × 2 table, with the log ratio as the effect size).
import { words } from './counts';

export const tokens = (text: string, keepCase = false): string[] =>
  words(text).map((word) => (keepCase ? word : word.toLowerCase().replace(/’/g, "'")));

/** A short English stop-word list (function words), for leaving out of frequency lists. */
export const STOP_WORDS = new Set(
  (
    'a an and are as at be but by for from had has have he her his i in is it its me my not of on or our she so ' +
    'that the their them they this to was we were what which who will with you your'
  ).split(' '),
);

export function frequencies(list: readonly string[], skipStop = false): [string, number][] {
  const counts = new Map<string, number>();
  for (const word of list) if (!(skipStop && STOP_WORDS.has(word))) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function typeTokenRatio(list: readonly string[]): number {
  if (list.length === 0) throw new Error('empty');
  return new Set(list).size / list.length;
}

/** The moving-average type-token ratio over windows of this many tokens (the whole text if it is shorter). */
export function movingTtr(list: readonly string[], window = 50): number {
  if (list.length === 0) throw new Error('empty');
  if (list.length <= window) return typeTokenRatio(list);
  let sum = 0;
  for (let i = 0; i + window <= list.length; i++) sum += new Set(list.slice(i, i + window)).size / window;
  return sum / (list.length - window + 1);
}

export function ngrams(list: readonly string[], n: number): [string, number][] {
  if (!Number.isInteger(n) || n < 1 || n > 6) throw new Error('ngram');
  const grams: string[] = [];
  for (let i = 0; i + n <= list.length; i++) grams.push(list.slice(i, i + n).join(' '));
  return frequencies(grams);
}

export interface Line {
  left: string;
  key: string;
  right: string;
  at: number;
}

/** Every use of a word (or a phrase), with this many words of context each side; sorted as asked. */
export function kwic(text: string, query: string, span = 5, sort: 'order' | 'left' | 'right' = 'order'): Line[] {
  const all = tokens(text, true);
  const lower = all.map((word) => word.toLowerCase());
  const target = tokens(query);
  if (target.length === 0) throw new Error('query');
  const lines: Line[] = [];
  for (let i = 0; i + target.length <= lower.length; i++) {
    if (!target.every((word, j) => lower[i + j] === word)) continue;
    lines.push({
      left: all.slice(Math.max(0, i - span), i).join(' '),
      key: all.slice(i, i + target.length).join(' '),
      right: all.slice(i + target.length, i + target.length + span).join(' '),
      at: i,
    });
  }
  const side = (line: Line) =>
    sort === 'left' ? line.left.toLowerCase().split(' ').reverse().join(' ') : line.right.toLowerCase();
  return sort === 'order' ? lines : [...lines].sort((a, b) => side(a).localeCompare(side(b)) || a.at - b.at);
}

/** Pointwise mutual information in bits: log2(O N / (f1 f2)). */
export function mutualInformation(observed: number, total: number, first: number, second: number): number {
  if (!(observed > 0 && total > 0 && first > 0 && second > 0)) throw new Error('positive');
  return Math.log2((observed * total) / (first * second));
}

/** The t-score: (O − E) / √O, with E = f1 f2 / N. */
export const tScore = (observed: number, total: number, first: number, second: number): number =>
  (observed - (first * second) / total) / Math.sqrt(observed);

const term = (o: number, e: number) => (o > 0 ? o * Math.log(o / e) : 0);

/** G² = 2 Σ O ln(O/E) over the four cells of a 2 × 2 table [[a, b], [c, d]]. */
export function gSquared(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  if (![a, b, c, d].every((x) => x >= 0) || n === 0) throw new Error('positive');
  const rows = [a + b, c + d];
  const cols = [a + c, b + d];
  const cells: [number, number, number][] = [
    [a, 0, 0],
    [b, 0, 1],
    [c, 1, 0],
    [d, 1, 1],
  ];
  return 2 * cells.reduce((sum, [o, r, k]) => sum + term(o, (rows[r]! * cols[k]!) / n), 0);
}

/** Keyness of a word used `a` times in a corpus of `n1` words against `b` times in `n2` words. */
export function keyness(a: number, n1: number, b: number, n2: number): { g2: number; logRatio: number } {
  if (!(n1 > 0 && n2 > 0) || a < 0 || b < 0 || a > n1 || b > n2) throw new Error('positive');
  // The log ratio adds half a use to each side so a word missing from one corpus still has a finite size.
  const logRatio = Math.log2((a || 0.5) / n1 / ((b || 0.5) / n2));
  return { g2: gSquared(a, b, n1 - a, n2 - b), logRatio };
}

export interface Collocate {
  word: string;
  observed: number;
  frequency: number;
  mi: number;
  t: number;
  g2: number;
}

/** Words found within `span` words of the node word, with their scores. */
export function collocates(list: readonly string[], node: string, span = 4, least = 2): Collocate[] {
  const target = node.toLowerCase();
  const total = list.length;
  const counts = new Map(frequencies(list));
  const nodeCount = counts.get(target) ?? 0;
  if (nodeCount === 0) throw new Error('notFound');
  const near = new Map<string, number>();
  list.forEach((word, i) => {
    if (word !== target) return;
    for (let j = Math.max(0, i - span); j <= Math.min(total - 1, i + span); j++)
      if (j !== i) near.set(list[j]!, (near.get(list[j]!) ?? 0) + 1);
  });
  return [...near]
    .filter(([, observed]) => observed >= least)
    .map(([word, observed]) => {
      const frequency = counts.get(word)!;
      // The window covers 2 × span words around each use of the node.
      const expectedBase = nodeCount * 2 * span;
      return {
        word,
        observed,
        frequency,
        mi: Math.log2((observed * total) / (frequency * expectedBase)),
        t: (observed - (frequency * expectedBase) / total) / Math.sqrt(observed),
        g2: gSquared(
          observed,
          Math.max(0, expectedBase - observed),
          Math.max(0, frequency - observed),
          Math.max(0, total - expectedBase - frequency + observed),
        ),
      };
    })
    .sort((a, b) => b.mi - a.mi || b.observed - a.observed);
}
