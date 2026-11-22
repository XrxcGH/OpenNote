// A line diff of expected and actual output for the Tests panel: the longest common subsequence of lines. Each row
// says which side it is from, so the panel can show the words "Expected" and "Actual" and not only a color.

export interface DiffRow {
  /** "same" is in both; "expected" only in the expected text; "actual" only in the actual text. */
  side: 'same' | 'expected' | 'actual';
  text: string;
  /** The line's number in its own text, from 1 (for "same", the actual text's). */
  line: number;
}

/** The most lines of each text that are compared; the rest is cut so a huge output cannot stall the panel. */
export const DIFF_LINES = 400;

const split = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').slice(0, DIFF_LINES);

export function diffLines(expected: string, actual: string): DiffRow[] {
  const e = split(expected);
  const a = split(actual);
  // lengths[i][j] is the common length of e[i..] and a[j..].
  const lengths: number[][] = Array.from({ length: e.length + 1 }, () => new Array<number>(a.length + 1).fill(0));
  for (let i = e.length - 1; i >= 0; i--)
    for (let j = a.length - 1; j >= 0; j--)
      lengths[i]![j] = e[i] === a[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < e.length || j < a.length) {
    if (i < e.length && j < a.length && e[i] === a[j]) {
      rows.push({ side: 'same', text: e[i]!, line: j + 1 });
      i++;
      j++;
    } else if (j < a.length && (i === e.length || lengths[i]![j + 1]! >= lengths[i + 1]![j]!)) {
      rows.push({ side: 'actual', text: a[j]!, line: j + 1 });
      j++;
    } else {
      rows.push({ side: 'expected', text: e[i]!, line: i + 1 });
      i++;
    }
  }
  return rows;
}

/** The first token (from 1) where two texts differ, with both tokens, or null when the tokens are the same. */
export function firstDifferentToken(
  expected: string,
  actual: string,
): { at: number; expected: string; actual: string } | null {
  const e = expected.split(/\s+/).filter(Boolean);
  const a = actual.split(/\s+/).filter(Boolean);
  for (let at = 0; at < Math.max(e.length, a.length); at++)
    if (e[at] !== a[at]) return { at: at + 1, expected: e[at] ?? '', actual: a[at] ?? '' };
  return null;
}
