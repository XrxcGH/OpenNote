// Line helpers for checkers that report offsets but word their messages in lines.

/** The offset where each line starts. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** The 1-based line of `offset`. */
export function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** The offset range of a 1-based line, without its line break. */
export function lineRange(text: string, starts: readonly number[], line: number): { from: number; to: number } {
  const from = starts[Math.max(0, Math.min(line - 1, starts.length - 1))];
  let to = text.indexOf('\n', from);
  if (to < 0) to = text.length;
  if (to > from && text.charCodeAt(to - 1) === 13) to -= 1;
  return { from, to };
}
