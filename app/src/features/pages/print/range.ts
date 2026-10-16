// Which sheets to print: a page range typed as in any print dialog ("1-3, 5, 8-"), with odd or even sheets only.

export type Parity = 'all' | 'odd' | 'even';

export type RangeError = 'syntax' | 'empty';

export interface RangeResult {
  /** The sheet indexes to print, from 0, in order, each once. */
  readonly sheets: readonly number[];
  readonly error?: RangeError;
}

/**
 * Reads a page range for a page of `count` sheets. Sheet numbers start at 1. `3-` means from 3 to the end, `-3` means
 * from the start to 3, and `5-2` is read as `2-5`. Numbers past the end are dropped. Empty text means every sheet. A
 * range that selects nothing, such as `9` on a three-sheet page, or text that is not a range, is an error.
 */
export function parsePageRange(text: string, count: number, parity: Parity = 'all'): RangeResult {
  const all = Array.from({ length: count }, (_, i) => i);
  const keep = (i: number) => parity === 'all' || (parity === 'odd') === (i % 2 === 0);
  const trimmed = text.trim();
  if (trimmed === '') return { sheets: all.filter(keep) };
  const picked = new Set<number>();
  for (const part of trimmed.split(/[,;]/)) {
    const m = /^\s*(\d*)\s*(-)?\s*(\d*)\s*$/.exec(part);
    if (!m || (m[1] === '' && m[3] === '') || (!m[2] && m[3] !== '')) return { sheets: [], error: 'syntax' };
    const first = m[1] === '' ? 1 : Number(m[1]);
    const last = m[2] ? (m[3] === '' ? count : Number(m[3])) : first;
    const [lo, hi] = first <= last ? [first, last] : [last, first];
    for (let n = Math.max(1, lo); n <= Math.min(count, hi); n += 1) picked.add(n - 1);
  }
  const sheets = [...picked].filter(keep).sort((a, b) => a - b);
  return sheets.length === 0 ? { sheets, error: 'empty' } : { sheets };
}
