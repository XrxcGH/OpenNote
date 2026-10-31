// Comparing versions of a text word by word: a shortest edit script, grouped into variants. Each variant
// says where the base text and the witness differ and what each reads, as in a critical apparatus.

export type Op = { kind: 'same' | 'removed' | 'added'; word: string };

/** A shortest edit script from a to b, from the longest common subsequence of words (the same length of script as
 * Myers's algorithm finds). Texts up to about 2,000 words a side. */
export function diffWords(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) throw new Error('tooLong');
  // lcs[i][j]: the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ kind: 'same', word: a[i]! });
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) ops.push({ kind: 'added', word: b[j++]! });
    else ops.push({ kind: 'removed', word: a[i++]! });
  }
  return ops;
}

export interface Variant {
  /** The 1-based number of the base word where the variant starts (or the word it follows, for an addition). */
  at: number;
  base: string;
  witness: string;
}

/** The places where the witness differs from the base, with neighboring changes joined. */
export function variants(ops: readonly Op[]): Variant[] {
  const out: Variant[] = [];
  let position = 0;
  let open: { start: number; base: string[]; witness: string[] } | null = null;
  const close = () => {
    if (open) {
      const at = open.base.length > 0 ? open.start + 1 : Math.max(open.start, 1);
      out.push({ at, base: open.base.join(' '), witness: open.witness.join(' ') });
    }
    open = null;
  };
  for (const op of ops) {
    if (op.kind === 'same') {
      close();
      position++;
      continue;
    }
    open ??= { start: position, base: [], witness: [] };
    if (op.kind === 'removed') {
      position++;
      open.base.push(op.word);
    } else open.witness.push(op.word);
  }
  close();
  return out;
}
