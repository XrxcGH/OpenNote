// What a PDF page or a slide keeps in its image block (A4-10). The page is a picture locked in place, so ink stays where
// it was written. The block's data also keeps the page's words with their boxes, for selecting text and for highlights.
// It keeps the boxes of the pictures inside the page, so the Evening theme can leave them in their own colors. And it
// keeps the page's plain text, which search reads. Every box is a fraction of the picture, from 0 to 1, so it holds at
// any size. This file is plain data and math, with no DOM, so unit tests cover all of it.
import type { BlockJson } from '../../services/pages/types';

/** A box as fractions of the picture: left, top, width, height. */
export type Box = readonly [x: number, y: number, w: number, h: number];
/** A word and its box, stored compactly as [x, y, w, h, text]. */
export type StoredWord = readonly [x: number, y: number, w: number, h: number, text: string];

export interface PdfPageData {
  /** The file's name, which groups the pages of one PDF for highlights. */
  file: string;
  /** The page number, from 1. */
  page: number;
  /** How many pages the file has. */
  pages: number;
}

/** How a PDF page or slide shows in the Evening theme. */
export type PdfLook = 'dim' | 'invert' | 'original';
export const LOOKS: readonly PdfLook[] = ['dim', 'invert', 'original'];

/** The most words kept for one page, and the most text search gets. */
export const MAX_WORDS = 20_000;
export const MAX_TEXT_CHARS = 60_000;
/** The most picture boxes kept for one page. */
export const MAX_IMAGE_BOXES = 200;

const round = (value: number) => Math.round(value * 10_000) / 10_000;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** A box rounded and kept inside the picture, or null when nothing of it is inside. */
export function cleanBox(x: number, y: number, w: number, h: number): Box | null {
  if (![x, y, w, h].every(Number.isFinite)) return null;
  const left = clamp01(Math.min(x, x + w));
  const top = clamp01(Math.min(y, y + h));
  const right = clamp01(Math.max(x, x + w));
  const bottom = clamp01(Math.max(y, y + h));
  if (right - left <= 0 || bottom - top <= 0) return null;
  return [round(left), round(top), round(right - left), round(bottom - top)];
}

/**
 * Splits a run of text into words. Each word gets a share of the run's width by its count of characters, which is
 * close enough to select and highlight words in one line.
 */
export function wordsOfRun(text: string, box: Box): StoredWord[] {
  const length = [...text].length;
  if (length === 0) return [];
  const [x, y, w, h] = box;
  const words: StoredWord[] = [];
  let at = 0;
  for (const part of text.split(/(\s+)/)) {
    const size = [...part].length;
    if (size > 0 && part.trim()) {
      const cleaned = cleanBox(x + (w * at) / length, y, (w * size) / length, h);
      if (cleaned) words.push([...cleaned, part] as StoredWord);
    }
    at += size;
  }
  return words;
}

/** The page's text in reading order: words on one line joined by spaces, and lines by line breaks. */
export function textOfWords(words: readonly StoredWord[]): string {
  let text = '';
  let lastTop: number | null = null;
  let lastHeight = 0;
  for (const [, y, , h, word] of words) {
    if (lastTop === null) text = word;
    else if (Math.abs(y - lastTop) > Math.max(h, lastHeight) / 2) text += `\n${word}`;
    else text += ` ${word}`;
    lastTop = y;
    lastHeight = h;
  }
  return text.slice(0, MAX_TEXT_CHARS);
}

/** Multiplies two PDF transforms [a, b, c, d, e, f]: first `m1`, then `m2`. */
export function multiply(m1: readonly number[], m2: readonly number[]): number[] {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

/** The operator codes the picture walk needs, from pdf.js's OPS table. */
export interface ImageOps {
  save: number;
  restore: number;
  transform: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageXObjectRepeat: number;
}

/**
 * The boxes of the pictures a page paints, from its operator list. A picture fills the unit square of the current
 * transform, which `viewport` maps to the page picture's pixels; the boxes come out as fractions of `size`.
 */
export function imageBoxes(
  ops: { fnArray: readonly number[]; argsArray: readonly unknown[] },
  codes: ImageOps,
  viewport: readonly number[],
  size: { width: number; height: number },
): Box[] {
  const stack: number[][] = [];
  let current = [1, 0, 0, 1, 0, 0];
  const boxes: Box[] = [];
  const painted = new Set([codes.paintImageXObject, codes.paintInlineImageXObject, codes.paintImageXObjectRepeat]);
  ops.fnArray.forEach((code, index) => {
    if (code === codes.save) stack.push(current);
    else if (code === codes.restore) current = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (code === codes.transform) {
      const args = ops.argsArray[index];
      if (Array.isArray(args) && args.length === 6 && args.every((n) => typeof n === 'number')) {
        current = multiply(args as number[], current);
      }
    } else if (painted.has(code) && boxes.length < MAX_IMAGE_BOXES) {
      const m = multiply(current, viewport);
      const corners = [
        [m[4], m[5]],
        [m[0] + m[4], m[1] + m[5]],
        [m[2] + m[4], m[3] + m[5]],
        [m[0] + m[2] + m[4], m[1] + m[3] + m[5]],
      ];
      const xs = corners.map(([x]) => x / size.width);
      const ys = corners.map(([, y]) => y / size.height);
      const box = cleanBox(
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      );
      if (box) boxes.push(box);
    }
  });
  return boxes;
}

/** The PDF page a block shows, or null for any other block. */
export function pdfOf(block: Pick<BlockJson, 'type' | 'data'>): PdfPageData | null {
  if (block.type !== 'image') return null;
  const pdf = block.data.pdf as Partial<PdfPageData> | undefined;
  if (!pdf || typeof pdf !== 'object') return null;
  const { file, page, pages } = pdf;
  if (typeof file !== 'string' || typeof page !== 'number' || typeof pages !== 'number') return null;
  return { file, page, pages };
}

/**
 * A page picture to write on: an image from a PDF or a slide. The core does not keep the `lock` an import asks for on
 * a new block, so the PDF or slide marker in `data` is what says it is a page picture; a lock is not required.
 */
export function isPagePicture(block: Pick<BlockJson, 'type' | 'data' | 'lock'>): boolean {
  if (block.type !== 'image') return false;
  return pdfOf(block) !== null || block.data.background === 'slide' || block.data.background === 'pdf';
}

/** The words a block keeps, checked, or an empty list. */
export function wordsOf(block: Pick<BlockJson, 'data'>): StoredWord[] {
  const words = block.data.words;
  if (!Array.isArray(words)) return [];
  return words
    .slice(0, MAX_WORDS)
    .filter(
      (word): word is StoredWord =>
        Array.isArray(word) &&
        word.length === 5 &&
        word.slice(0, 4).every((n) => typeof n === 'number' && Number.isFinite(n)) &&
        typeof word[4] === 'string',
    );
}

/** The picture boxes a block keeps, checked. */
export function imageBoxesOf(block: Pick<BlockJson, 'data'>): Box[] {
  const boxes = block.data.images;
  if (!Array.isArray(boxes)) return [];
  return boxes
    .slice(0, MAX_IMAGE_BOXES)
    .filter(
      (box): box is Box =>
        Array.isArray(box) && box.length === 4 && box.every((n) => typeof n === 'number' && Number.isFinite(n)),
    );
}

/** How the block shows in the Evening theme. Dimmed unless the person chose otherwise. */
export function lookOf(block: Pick<BlockJson, 'data'>): PdfLook {
  const look = block.data.look;
  return LOOKS.includes(look as PdfLook) ? (look as PdfLook) : 'dim';
}
