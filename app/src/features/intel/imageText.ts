// Text in images (Phase 12): turns an image file into pixels for the on-device text recognizer, and the lines it
// finds into text. The pixels go to the Rust crate on this computer and nowhere else. A big image is scaled down
// first, and the color is dropped, because recognition needs only the shapes of the letters.
import { toIntelError } from '../../services/intel';
import type { ImagePixels, IntelClient, OcrResult } from '../../services/intel';
import { intelClient } from './runtime';

/** The longest side sent for recognition. Windows reads ordinary text well below this, and a smaller image is faster. */
export const MAX_OCR_SIDE = 3200;

/** The size an image is read at: its own size, or scaled down so its longest side is `max`. */
export function sizeForReading(width: number, height: number, max = MAX_OCR_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Gray pixels from RGBA, with a transparent area read as white paper. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const gray = new Uint8Array(rgba.length / 4);
  for (let from = 0, to = 0; from < rgba.length; from += 4, to += 1) {
    const alpha = rgba[from + 3] / 255;
    const luma = 0.299 * rgba[from] + 0.587 * rgba[from + 1] + 0.114 * rgba[from + 2];
    gray[to] = Math.round(luma * alpha + 255 * (1 - alpha));
  }
  return gray;
}

/** Decodes an image file into gray pixels at the size it is read at. A transparent area reads as white paper. */
export async function pixelsFromBlob(blob: Blob, max = MAX_OCR_SIDE): Promise<ImagePixels> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = sizeForReading(bitmap.width, bitmap.height, max);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('A canvas is not available to read the image.');
    context.drawImage(bitmap, 0, 0, width, height);
    return { width, height, format: 'gray8', pixels: toGray(context.getImageData(0, 0, width, height).data) };
  } finally {
    bitmap.close();
  }
}

/** The text of a result: one line for each line the recognizer found. */
export function textOfResult(result: Pick<OcrResult, 'lines'>): string {
  return result.lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join('\n');
}

export interface ReadImageOptions {
  /** A language tag, or the languages of the person's Windows profile. */
  language?: string;
  client?: () => Promise<IntelClient>;
  decode?: (blob: Blob) => Promise<ImagePixels>;
}

/** The text in an image file. Rejects with IntelClientError, such as `disabled` or `languageUnavailable`. */
export async function readTextInImage(blob: Blob, options: ReadImageOptions = {}): Promise<OcrResult> {
  try {
    const pixels = await (options.decode ?? pixelsFromBlob)(blob);
    const client = await (options.client ?? intelClient)();
    return await client.recognizeImage(pixels, options.language ? { language: options.language } : {});
  } catch (error) {
    throw toIntelError(error);
  }
}
