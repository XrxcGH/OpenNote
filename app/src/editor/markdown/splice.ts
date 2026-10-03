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

/**
 * The UTF-8 byte offset of an index in UTF-16 units in `text`, counted without encoding. A lone surrogate counts 3
 * bytes, as the U+FFFD that `TextEncoder` writes for it.
 */
export function utf8Offset(text: string, utf16Index: number): number {
  const end = Math.min(Math.max(0, utf16Index), text.length);
  let bytes = 0;
  for (let i = 0; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (isHigh(code) && i + 1 < end && isLow(text.charCodeAt(i + 1))) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
