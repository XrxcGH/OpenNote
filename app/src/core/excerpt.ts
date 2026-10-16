// Short pieces of longer text for previews and quotes. A piece never ends in the middle of a word: a cut moves back to
// the space before it, and says it cut with an ellipsis.

const ELLIPSIS = '\u2026';

/** The start of `text`, at most `max` characters before the ellipsis, cut between words. */
export function excerpt(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  // A cut inside a word, which the next character continues, moves back to the word's start.
  if (!/\s/.test(text[end] ?? '') && !/\s/.test(text[end - 1] ?? '')) {
    const space = text.lastIndexOf(' ', end);
    if (space > max / 2) end = space;
  }
  return `${text.slice(0, end).trimEnd()}${ELLIPSIS}`;
}

/** Up to `max` characters of `text` after `from`, cut between words, with an ellipsis where it stopped short. */
export function after(text: string, from: number, max: number): string {
  const rest = text.slice(from);
  return rest.length <= max ? rest : excerpt(rest, max);
}

/** Up to `max` characters of `text` before `to`, starting between words, with an ellipsis where it began late. */
export function before(text: string, to: number, max: number): string {
  const from = Math.max(0, to - max);
  if (from === 0) return text.slice(0, to);
  let start = from;
  if (!/\s/.test(text[start] ?? '') && !/\s/.test(text[start - 1] ?? '')) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < to) start = space + 1;
  }
  return `${ELLIPSIS}${text.slice(start, to).trimStart()}`;
}
