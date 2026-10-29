// Text in images (Phase 12): turns an image file into pixels for the on-device text recognizer, and the lines it
// finds into text. The pixels go to the Rust crate on this computer and nowhere else. A big image is scaled down
// first, and the color is dropped, because recognition needs only the shapes of the letters.
import { toIntelError } from '../../services/intel';
import type { ImagePixels, IntelClient, OcrResult } from '../../services/intel';
import { ocrLanguage } from '../../state/language';
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

/** A word and its box as fractions of the image: [x, y, w, h, text]. */
export type WordBox = [x: number, y: number, w: number, h: number, text: string];

/** The most words kept for one image. */
export const MAX_WORD_BOXES = 5000;

/** The words of a result with their boxes as fractions of an image `width` by `height` pixels. Empty boxes are left out. */
export function wordBoxes(result: Pick<OcrResult, 'lines'>, width: number, height: number): WordBox[] {
  if (!(width > 0 && height > 0)) return [];
  const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
  const boxes: WordBox[] = [];
  for (const line of result.lines) {
    for (const word of line.words) {
      const { x, y, width: w, height: h } = word.bounds;
      if (!word.text.trim() || !(w > 0 && h > 0) || boxes.length >= MAX_WORD_BOXES) continue;
      boxes.push([round(x / width), round(y / height), round(w / width), round(h / height), word.text]);
    }
  }
  return boxes;
}

export interface ReadImageOptions {
  /** A language tag. The chosen language when left out; the Windows profile's languages if it has no OCR pack. */
  language?: string;
  client?: () => Promise<IntelClient>;
  decode?: (blob: Blob) => Promise<ImagePixels>;
}

/** The text in an image file. Rejects with IntelClientError, such as `disabled` or `languageUnavailable`. */
export async function readTextInImage(blob: Blob, options: ReadImageOptions = {}): Promise<OcrResult> {
  try {
    const pixels = await (options.decode ?? pixelsFromBlob)(blob);
    const client = await (options.client ?? intelClient)();
    const language = options.language ?? ocrLanguage();
    try {
      return await client.recognizeImage(pixels, { language });
    } catch (error) {
      // No OCR pack for the chosen language: read in the Windows profile's languages rather than not at all.
      if (options.language || toIntelError(error).code !== 'languageUnavailable') throw error;
      return await client.recognizeImage(pixels, {});
    }
  } catch (error) {
    throw toIntelError(error);
  }
}
