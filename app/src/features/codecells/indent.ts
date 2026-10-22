// Tab and Shift+Tab in a code cell's text: indent or outdent the lines of the selection, or put spaces at the caret.

export interface Indented {
  text: string;
  start: number;
  end: number;
}

/** The text after Tab (or Shift+Tab when `outdent`) with the selection from `start` to `end`. */
export function indentAt(text: string, start: number, end: number, outdent: boolean, width: number): Indented {
  const unit = ' '.repeat(width);
  if (!outdent && start === end) {
    return { text: text.slice(0, start) + unit + text.slice(end), start: start + width, end: start + width };
  }
  const first = text.lastIndexOf('\n', start - 1) + 1;
  const lines = text.slice(first, end).split('\n');
  let removedFirst = 0;
  let change = 0;
  const changed = lines.map((line, index) => {
    if (!outdent) {
      change += width;
      if (index === 0) removedFirst = -width;
      return unit + line;
    }
    const spaces = Math.min(width, line.length - line.trimStart().length);
    change -= spaces;
    if (index === 0) removedFirst = spaces;
    return line.slice(spaces);
  });
  const next = text.slice(0, first) + changed.join('\n') + text.slice(end);
  return { text: next, start: Math.max(first, start - removedFirst), end: end + change };
}
