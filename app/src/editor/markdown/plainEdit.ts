// Quick checks on one edit of a block's Markdown, so typing plain words does not parse the whole block on every key
// to find its footnote references or its comment and suggestion marks (B12 typing gate). Each check answers "the
// edit cannot have changed them" or "parse to find out". Neither ever says "changed".

/** Characters that can start or end a reference, a mark, a code span, or a block. */
const STRUCTURAL = /[\n`\\[\]^<>~*_$&#|]/;
/** A whole `[^ID]` is 29 characters, so 32 around an edit covers a reference the edit could be inside. */
const NEAR = 32;

/**
 * Where the edit from `before` to `after` starts, when it is plain text only: no character that can change how the
 * Markdown is read, and no spaces that begin a line (an indented code block). Null when the edit needs a parse.
 */
function plainEdit(before: string, after: string): { start: number; cutEnd: number; putEnd: number } | null {
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  let tail = 0;
  while (
    tail < max - start &&
    before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)
  )
    tail += 1;
  const cutEnd = before.length - tail;
  const putEnd = after.length - tail;
  const cut = before.slice(start, cutEnd);
  const put = after.slice(start, putEnd);
  if (STRUCTURAL.test(cut) || STRUCTURAL.test(put)) return null;
  // A space or tab inside a line's leading whitespace can make 4 spaces: an indented code block.
  const lineStart = before.lastIndexOf('\n', start - 1) + 1;
  if (/^[ \t]*$/.test(before.slice(lineStart, start)) && /[ \t]/.test(cut + put)) return null;
  return { start, cutEnd, putEnd };
}

/** True when the edit cannot have changed which footnote references the Markdown holds. */
export function editKeepsRefs(before: string, after: string): boolean {
  if (before === after) return true;
  const edit = plainEdit(before, after);
  if (!edit) return false;
  const near = (text: string, end: number) => text.slice(Math.max(0, edit.start - NEAR), end + NEAR);
  return !near(before, edit.cutEnd).includes('[^') && !near(after, edit.putEnd).includes('[^');
}

/** True when the edit cannot have changed which comment or suggestion marks the Markdown holds: it is outside tags. */
export function editKeepsMarks(before: string, after: string): boolean {
  if (before === after) return true;
  const edit = plainEdit(before, after);
  if (!edit) return false;
  // Inside a tag means a `<` before the edit with no `>` after it. The edit has neither character itself.
  return after.lastIndexOf('<', edit.start - 1) <= after.lastIndexOf('>', edit.start - 1);
}
