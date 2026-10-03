// Text copied from a PDF is hard-wrapped: every line ends where the page ended, so a pasted paragraph is a column of
// short lines (Phase 4 design, 15.6 and 15.7). The text is joined in a separate step, so one Undo leaves the raw paste.

const MIN_LINES = 3;
const MIN_MEDIAN = 30;
const NEAR_MEDIAN = 0.25;
const SHARE_NEAR = 0.6;
const SENTENCE_END = /[.!?:;]["'\u201d\u2019)\]]*$/;
const LIST_START = /^(?:[-*+\u2022\u25e6\u25aa]|\d+[.)]|[a-z][.)])\s/;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function linesOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
}

/**
 * Plain text is treated as hard-wrapped when it has at least 3 lines, at least 60% of the lines are within 25% of
 * the median length (and the median is at least 30 characters), and fewer than half end with sentence punctuation.
 */
export function looksHardWrapped(text: string): boolean {
  const lines = linesOf(text);
  if (lines.length < MIN_LINES) return false;
  const lengths = lines.map((line) => line.length);
  const mid = median(lengths);
  if (mid < MIN_MEDIAN) return false;
  const near = lengths.filter((length) => Math.abs(length - mid) <= mid * NEAR_MEDIAN).length;
  const ended = lines.filter((line) => SENTENCE_END.test(line)).length;
  return near >= lines.length * SHARE_NEAR && ended < lines.length / 2;
}

/** Joins two lines: a hyphen at the end of a line before a lowercase letter is a split word, so it is removed. */
function joinLine(joined: string, next: string): string {
  if (/[A-Za-z]-$/.test(joined) && /^\p{Ll}/u.test(next)) return joined.slice(0, -1) + next;
  return `${joined} ${next.trimStart()}`;
}

/**
 * Text with its broken lines joined into paragraphs. A blank line, or a line that starts a list item, starts a new
 * paragraph. Returns null when the text does not look hard-wrapped.
 */
export function joinBrokenLines(text: string): string | null {
  if (!looksHardWrapped(text)) return null;
  const paragraphs: string[] = [];
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  for (const block of blocks) {
    let current: string | null = null;
    for (const line of linesOf(block)) {
      if (current === null || LIST_START.test(line.trimStart())) {
        if (current !== null) paragraphs.push(current);
        current = line.trim();
      } else current = joinLine(current, line);
    }
    if (current !== null) paragraphs.push(current);
  }
  return paragraphs.join('\n\n');
}
