// The changes between a text and its suggested rewrite, as runs of words kept, added, and removed, so the suggestion
// can be shown with every change marked. It compares words and the spaces and marks between them, which is how a
// person reads a change. A text too long to compare is shown as one removal and one addition.

export type DiffKind = 'same' | 'add' | 'del';

export interface DiffRun {
  kind: DiffKind;
  text: string;
}

/** The most pieces compared on each side. The comparison takes time and memory in proportion to their product. */
export const MAX_PIECES = 3000;

const PIECE = /\s+|[\p{L}\p{N}'’]+|[^\s\p{L}\p{N}]/gu;

export function pieces(text: string): string[] {
  return text.match(PIECE) ?? [];
}

/** Joins neighbors of the same kind. */
function merge(runs: DiffRun[]): DiffRun[] {
  const out: DiffRun[] = [];
  for (const run of runs) {
    const last = out.at(-1);
    if (last && last.kind === run.kind) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}

/** The runs that turn `before` into `after`. Reading the `same` and `add` runs gives `after`, and `same` and `del` gives `before`. */
export function diffWords(before: string, after: string): DiffRun[] {
  if (before === after) return before ? [{ kind: 'same', text: before }] : [];
  const a = pieces(before);
  const b = pieces(after);
  if (a.length > MAX_PIECES || b.length > MAX_PIECES) {
    return merge([
      { kind: 'del', text: before },
      { kind: 'add', text: after },
    ]);
  }
  // The length of the longest common run from each pair of positions to the ends.
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const runs: DiffRun[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      runs.push({ kind: 'same', text: a[i] ?? '' });
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      runs.push({ kind: 'del', text: a[i] ?? '' });
      i += 1;
    } else {
      runs.push({ kind: 'add', text: b[j] ?? '' });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) runs.push({ kind: 'del', text: a[i] ?? '' });
  for (; j < b.length; j += 1) runs.push({ kind: 'add', text: b[j] ?? '' });
  return merge(runs);
}

/** How many separate changes the runs hold. */
export function changeCount(runs: readonly DiffRun[]): number {
  let count = 0;
  let inChange = false;
  for (const run of runs) {
    const changed = run.kind !== 'same';
    if (changed && !inChange) count += 1;
    inChange = changed;
  }
  return count;
}
