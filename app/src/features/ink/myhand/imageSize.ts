// The size of an uploaded picture, read from its first bytes before anything decodes it (flag ink.myHandwriting).
// A small file can still claim a huge picture, so the upload path checks this against its pixel cap first and never
// hands the browser's decoder a picture it would run out of memory on. Untrusted input: every read is bounds-checked.

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

const u16be = (b: Uint8Array, i: number) => (i + 2 <= b.length ? (b[i] << 8) | b[i + 1] : -1);
const u16le = (b: Uint8Array, i: number) => (i + 2 <= b.length ? b[i] | (b[i + 1] << 8) : -1);
const u24le = (b: Uint8Array, i: number) => (i + 3 <= b.length ? b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) : -1);
const u32be = (b: Uint8Array, i: number) => (i + 4 <= b.length ? u16be(b, i) * 65536 + u16be(b, i + 2) : -1);
const i32le = (b: Uint8Array, i: number) =>
  i + 4 <= b.length ? b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24) : 0;
const ascii = (b: Uint8Array, i: number, text: string) =>
  i + text.length <= b.length && [...text].every((c, k) => b[i + k] === c.charCodeAt(0));

const sized = (width: number, height: number): ImageSize | null => (width > 0 && height > 0 ? { width, height } : null);

function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2;
  // Markers to the first start-of-frame; a frame header holds the size. Bounded by the bytes given.
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return sized(u16be(b, i + 7), u16be(b, i + 5));
    i += 2 + length;
  }
  return null;
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (ascii(b, 12, 'VP8X')) return sized(u24le(b, 24) + 1, u24le(b, 27) + 1);
  if (ascii(b, 12, 'VP8L') && b[20] === 0x2f) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (ascii(b, 12, 'VP8 ')) return sized(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  return null;
}

/**
 * The picture's size from its header: PNG, JPEG, GIF, WebP, or BMP. Null for anything else or a header that
 * doesn't add up, which the upload path treats as a file it can't read. Give it the first 64 KB of the file.
 */
export function imageSize(b: Uint8Array): ImageSize | null {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 'PNG') && ascii(b, 12, 'IHDR'))
    return sized(u32be(b, 16), u32be(b, 20));
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  if (ascii(b, 0, 'GIF8') && b.length >= 10) return sized(u16le(b, 6), u16le(b, 8));
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return webpSize(b);
  if (ascii(b, 0, 'BM') && b.length >= 26) return sized(Math.abs(i32le(b, 18)), Math.abs(i32le(b, 22)));
  return null;
}
