// Opened files. The data fields read a file as text, so a picture, a zip, or a damaged file would come out as one
// row of strange characters; this says when the text is not text.

/** How many characters at the start the check looks at. */
const SAMPLE = 4096;

/**
 * True when text read from a file is binary: it holds a null character, or more than a few of its first characters are control
 * characters or the replacement character a decoder puts where a byte is not valid text. Tabs and line breaks count
 * as text.
 */
export function looksBinary(text: string): boolean {
  const head = text.length > SAMPLE ? text.slice(0, SAMPLE) : text;
  let odd = 0;
  for (let i = 0; i < head.length; i += 1) {
    const code = head.charCodeAt(i);
    if (code === 0) return true;
    if (code === 0xfffd || (code < 32 && code !== 9 && code !== 10 && code !== 13)) odd += 1;
  }
  return head.length > 0 && odd / head.length > 0.02;
}
