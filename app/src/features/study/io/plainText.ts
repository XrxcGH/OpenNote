// A card file must be text. Bytes that are not valid UTF-8, or that hold NUL or other control characters, are a
// binary file with a text name (T3-D10-5): refuse them instead of offering garbage as cards.

/** The text of the bytes, or null when they are not plain UTF-8 text. */
export function plainTextOf(bytes: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  // Tab, line feed, and carriage return are text. Every other C0 control, and DEL, is not.
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? null : text;
}
