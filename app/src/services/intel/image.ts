// Getting pixels ready for the wire: the size limits, the byte count check, and base64 (crates/intel/src/wire.rs,
// OcrSource). The limits match crates/intel/src/ocr/mod.rs, and contract.test.ts checks that they still do.

import { IntelClientError } from './errors';
import type { ImagePixels, OcrSource } from './types';

const BYTES_PER_PIXEL = { rgba8: 4, gray8: 1 } as const;

/** The longest side an image may have, in pixels. Windows OCR accepts no more. */
export const MAX_IMAGE_SIDE = 10_000;

/** The most pixels an image may have, about a 6,500 by 4,900 photo. Scale a larger one down before sending it. */
export const MAX_IMAGE_PIXELS = 32_000_000;

/**
 * Base64 of the bytes, in pieces so a large image does not overflow the call stack. Each piece is a whole number of
 * three-byte groups, so the pieces join into one valid text without a binary string the size of the image.
 */
export function toBase64(bytes: Uint8Array | Uint8ClampedArray): string {
  const piece = 3 * 0x2000;
  const parts: string[] = [];
  for (let at = 0; at < bytes.length; at += piece) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(at, at + piece))));
  }
  return parts.join('');
}

/**
 * Checks the size against the limits and the byte count, as the Rust side does, so a mistake fails here with a
 * clear code. The size is checked first, so an image that is too large is refused before it is encoded or copied.
 */
export function pixelSource(image: ImagePixels): OcrSource {
  const { width, height, format, pixels } = image;
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
    const limit = `${MAX_IMAGE_SIDE} on each side and ${MAX_IMAGE_PIXELS} in all`;
    throw new IntelClientError('imageTooLarge', `the image is ${width} by ${height} pixels, and the limit is ${limit}`);
  }
  const expected = width * height * BYTES_PER_PIXEL[format];
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    pixels.length !== expected
  ) {
    throw new IntelClientError(
      'invalidInput',
      `a ${width} by ${height} ${format} image needs ${expected} bytes, not ${pixels.length}`,
    );
  }
  return { kind: 'pixels', width, height, format, pixels: toBase64(pixels) };
}

/** Pixels from canvas image data, which is always RGBA. */
export function fromImageData(data: { width: number; height: number; data: Uint8ClampedArray }): ImagePixels {
  return { width: data.width, height: data.height, format: 'rgba8', pixels: data.data };
}
