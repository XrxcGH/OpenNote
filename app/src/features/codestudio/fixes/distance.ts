// "Did you mean" (DESIGN 7.1). The costs and the limit are the ones in CPython's own suggestion code (3.12).
// A move (insert or delete) costs 2. A change of letter costs 2. A change of case costs 1.
// A candidate is offered only when its distance is at most (len(a) + len(b) + 3) * 2 / 6.
// We add one thing CPython lacks. Swapping two neighbors costs 2, so "pritn" ranks above names that need two changes.

const MOVE = 2;
const CASE = 1;
const MAX_NAME = 40;

/** The weighted distance between two names (Damerau-Levenshtein with CPython's costs). */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) {
    rows.push(new Array<number>(b.length + 1).fill(0));
    rows[i]![0] = i * MOVE;
  }
  for (let j = 0; j <= b.length; j += 1) rows[0]![j] = j * MOVE;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const x = a[i - 1]!;
      const y = b[j - 1]!;
      const change = x === y ? 0 : x.toLowerCase() === y.toLowerCase() ? CASE : MOVE;
      let best = Math.min(rows[i - 1]![j]! + MOVE, rows[i]![j - 1]! + MOVE, rows[i - 1]![j - 1]! + change);
      if (i > 1 && j > 1 && x === b[j - 2] && a[i - 2] === y) best = Math.min(best, rows[i - 2]![j - 2]! + MOVE);
      rows[i]![j] = best;
    }
  }
  return rows[a.length]![b.length]!;
}

/** The most distance a candidate of this length may have from the wrong name. */
export function limit(a: string, b: string): number {
  return Math.floor(((a.length + b.length + 3) * MOVE) / 6);
}

/** The candidates worth offering for `wrong`, best first. Names that differ only in letter case come first. */
export function suggestions(wrong: string, candidates: Iterable<string>, count = 3): string[] {
  if (!wrong || wrong.length > MAX_NAME) return [];
  const scored: { name: string; cost: number; order: number }[] = [];
  const seen = new Set<string>();
  let order = 0;
  for (const name of candidates) {
    if (seen.has(name) || name === wrong || name.length > MAX_NAME) continue;
    seen.add(name);
    const cost = distance(wrong, name);
    if (cost <= limit(wrong, name)) scored.push({ name, cost, order: order++ });
    else order += 1;
  }
  scored.sort((p, q) => p.cost - q.cost || p.order - q.order);
  return scored.slice(0, count).map((s) => s.name);
}
