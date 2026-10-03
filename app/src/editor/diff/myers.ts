// Myers' O(ND) difference algorithm (ARCHITECTURE.md section 21; owner: WP7), over any two lists with an equality
// test. Compare versions uses it for a text block's paragraphs and for the words inside a changed paragraph.

export type DiffOp =
  { kind: 'equal'; a: number; b: number } | { kind: 'delete'; a: number } | { kind: 'insert'; b: number };

/** The furthest x reached on each diagonal k, for each number of edits d. */
function forwardTrace<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): number[][] {
  const max = a.length + b.length;
  const offset = max + 1;
  const v = new Array<number>(2 * max + 3).fill(0);
  const trace: number[][] = [];
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
      let x = down ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < a.length && y < b.length && same(a[x], b[y])) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= a.length && y >= b.length) return trace;
    }
  }
  return trace;
}

/** The shortest edit script from `a` to `b`, in order: equal runs, deletions from `a`, and insertions from `b`. */
export function myersDiff<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean = Object.is): DiffOp[] {
  const trace = forwardTrace(a, b, same);
  const offset = a.length + b.length + 1;
  const ops: DiffOp[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      ops.push({ kind: 'equal', a: x, b: y });
    }
    if (d > 0) {
      if (down) ops.push({ kind: 'insert', b: (y -= 1) });
      else ops.push({ kind: 'delete', a: (x -= 1) });
    }
  }
  return ops.reverse();
}

/** Words and the spaces between them, so joining the pieces gives the text back. */
export function wordPieces(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}'’_-]+|[^\s\p{L}\p{N}'’_-]/gu) ?? [];
}

export type WordPart = { kind: 'same' | 'added' | 'removed'; text: string };

/** A word-level diff of two texts, with neighboring parts of the same kind joined. */
export function diffWords(before: string, after: string): WordPart[] {
  const a = wordPieces(before);
  const b = wordPieces(after);
  const parts: WordPart[] = [];
  const push = (kind: WordPart['kind'], text: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  for (const op of myersDiff(a, b)) {
    if (op.kind === 'equal') push('same', a[op.a]);
    else if (op.kind === 'delete') push('removed', a[op.a]);
    else push('added', b[op.b]);
  }
  return parts;
}

/** The share of words two texts have in common, from 0 to 1, against the longer one. */
export function wordSimilarity(before: string, after: string): number {
  const words = (text: string) => wordPieces(text).filter((piece) => /[\p{L}\p{N}]/u.test(piece));
  const a = words(before.toLowerCase());
  const b = words(after.toLowerCase());
  const longest = Math.max(a.length, b.length);
  if (!longest) return 1;
  const common = myersDiff(a, b).filter((op) => op.kind === 'equal').length;
  return common / longest;
}
