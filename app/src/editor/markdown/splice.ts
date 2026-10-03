// The one splice between two Markdown strings, and UTF-8 offsets for the core (ARCHITECTURE.md section 10.2;
// owner after WP0: WP1). The core's `spliceText` takes its offset in UTF-8 bytes.

/** `at` is an index in UTF-16 units, never inside a surrogate pair. */
export interface MarkdownSplice {
  at: number;
  del: string;
  ins: string;
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** The shortest single splice that turns `before` into `after`, or null when they are equal. */
export function diffMarkdown(before: string, after: string): MarkdownSplice | null {
  if (before === after) return null;
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  if (start > 0 && isHigh(before.charCodeAt(start - 1))) start--;
  let end = 0;
  while (
    end < limit - start &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  ) {
    end++;
  }
  if (end > 0 && isLow(before.charCodeAt(before.length - end))) end--;
  return {
    at: start,
    del: before.slice(start, before.length - end),
    ins: after.slice(start, after.length - end),
  };
}

const encoder = new TextEncoder();

/** The UTF-8 byte offset of an index in UTF-16 units in `text`. */
export function utf8Offset(text: string, utf16Index: number): number {
  return encoder.encode(text.slice(0, utf16Index)).length;
}
