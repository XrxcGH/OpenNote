// Uploads of the person's own handwriting to symbols they can confirm (flag ink.myHandwriting). A PDF's ink is read
// from its drawing as vectors; a page that only holds pictures, and a scan or photo, are traced from their pixels.
// The strokes go into lines and symbols, the math reader's grouping tells bars, roots, integrals, and brackets
// apart, and the on-device handwriting recognizer reads the rest, one symbol at a time. Every file is untrusted:
// sizes are capped before anything is decoded, and a file that can't be read gives a calm error, never a crash.
import { loadPdfJs } from '../../../pdf';
import { pageInk } from '../../myhand/pdfInk';
import type { PdfOps } from '../../myhand/pdfInk';
import { groupSymbols, rectOf, splitLines } from '../../myhand/segment';
import type { Rect, WrittenLine } from '../../myhand/segment';
import { inkOf, traceBitmap } from '../../myhand/trace';
import type { Traced } from '../../myhand/trace';

export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
export const MAX_UPLOAD_PAGES = 30;
/** The most pixels a picture is traced at; bigger ones are scaled down first. */
export const MAX_TRACE_PIXELS = 9_000_000;
/** The most symbols one upload offers to confirm. */
export const MAX_SYMBOLS = 1500;

export type UploadError = 'tooBig' | 'unreadable' | 'nothing';

/** Why an upload gave no symbols. */
export class UploadFailure extends Error {
  constructor(readonly code: UploadError) {
    super(code);
  }
}

export interface UploadSymbol {
  readonly id: number;
  readonly strokes: Traced[];
  readonly rect: Rect;
  /** The line it is on, counted over the whole upload. */
  readonly line: number;
  /** What the math reader's shapes say it is, before any reading: a bar, a root, an integral, a bracket. */
  readonly role: string;
  /** Known from its shape alone, such as an equals sign. */
  readonly known?: string;
}

export interface UploadRead {
  readonly symbols: UploadSymbol[];
  readonly lines: number;
}

type Progress = (page: number, pages: number) => void;

const ROLE_LABELS: Record<string, string> = {
  bar: '-',
  radical: '√',
  integral: '∫',
  open: '(',
  close: ')',
  openSquare: '[',
  closeSquare: ']',
};

/** The label a symbol starts with in the confirm step, before the recognizer reads it. */
export const startLabel = (symbol: UploadSymbol): string => symbol.known ?? ROLE_LABELS[symbol.role] ?? '';

function opsOf(lib: { OPS: Record<string, number> }): PdfOps {
  const o = lib.OPS;
  return {
    save: o.save,
    restore: o.restore,
    transform: o.transform,
    setLineWidth: o.setLineWidth,
    constructPath: o.constructPath,
    fill: o.fill,
    eoFill: o.eoFill,
    fillStroke: o.fillStroke,
    eoFillStroke: o.eoFillStroke,
    closeFillStroke: o.closeFillStroke,
    closeEOFillStroke: o.closeEOFillStroke,
    stroke: o.stroke,
    closeStroke: o.closeStroke,
    paintImageXObject: o.paintImageXObject,
    paintInlineImageXObject: o.paintInlineImageXObject,
    paintImageMaskXObject: o.paintImageMaskXObject,
    paintFormXObjectBegin: o.paintFormXObjectBegin,
    paintFormXObjectEnd: o.paintFormXObjectEnd,
  };
}

/** Lets the page breathe between pages, so a long upload never freezes the window. */
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Gray levels of a picture drawn on a canvas, scaled down to the trace cap. */
function grayOf(
  source: CanvasImageSource,
  width: number,
  height: number,
): { gray: Uint8Array; w: number; h: number; scale: number } | null {
  if (!(width > 0 && height > 0)) return null;
  const scale = Math.min(1, Math.sqrt(MAX_TRACE_PIXELS / (width * height)));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  canvas.width = 0;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = Math.round(data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
  return { gray, w, h, scale };
}

/** Strokes traced from a picture, in the picture's own pixels. */
function tracePicture(source: CanvasImageSource, width: number, height: number): Traced[] {
  const gray = grayOf(source, width, height);
  if (!gray) return [];
  return traceBitmap(inkOf(gray.gray, gray.w, gray.h)).map((stroke) =>
    stroke.map((p) => ({ x: p.x / gray.scale, y: p.y / gray.scale, width: p.width / gray.scale })),
  );
}

async function readPdf(bytes: Uint8Array, progress: Progress): Promise<Traced[][]> {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({
    data: bytes,
    enableXfa: false,
    useWasm: false,
    useSystemFonts: true,
    stopAtErrors: false,
    disableAutoFetch: true,
    disableStream: true,
    verbosity: 0,
  }).promise;
  const pages: Traced[][] = [];
  try {
    const count = Math.min(doc.numPages, MAX_UPLOAD_PAGES);
    for (let n = 1; n <= count; n++) {
      progress(n, count);
      await pause();
      const page = await doc.getPage(n);
      const ink = pageInk(
        await page.getOperatorList(),
        opsOf(lib as unknown as { OPS: Record<string, number> }),
        page.view as [number, number, number, number],
      );
      let strokes = ink.strokes;
      if (strokes.length === 0 && ink.hasPictures) {
        // A scanned page: draw it and trace its pixels.
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        await page.render({ canvas, viewport }).promise;
        strokes = tracePicture(canvas, canvas.width, canvas.height).map((s) =>
          s.map((p) => ({ x: p.x / 2, y: p.y / 2, width: p.width / 2 })),
        );
        canvas.width = 0;
      }
      pages.push(strokes);
      page.cleanup();
    }
  } finally {
    await doc.loadingTask.destroy();
  }
  return pages;
}

async function readImage(file: Blob): Promise<Traced[][]> {
  const bitmap = await createImageBitmap(file);
  try {
    return [tracePicture(bitmap, bitmap.width, bitmap.height)];
  } finally {
    bitmap.close();
  }
}

/** Groups one line's strokes into symbols with the math reader's grouping, or the plain one when it can't load. */
async function symbolsOf(line: WrittenLine): Promise<{ strokes: Traced[]; role: string; known?: string }[]> {
  try {
    const intel = await import('../../../intel').then((module) => module.loadApi());
    const keyed = line.strokes.map((stroke, i) => ({ key: String(i), points: stroke.map((p) => [p.x, p.y] as const) }));
    return intel.groupStrokes(keyed).map((cluster) => ({
      strokes: cluster.strokes.map((s) => line.strokes[Number(s.key)]),
      role: cluster.role,
      known: cluster.text,
    }));
  } catch {
    return groupSymbols(line).map((group) => ({ strokes: group.strokes, role: 'char' }));
  }
}

/** Reads an upload into symbols. Throws an UploadError code for a file it can't use. */
export async function readUpload(file: File, progress: Progress = () => undefined): Promise<UploadRead> {
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadFailure('tooBig');
  let pages: Traced[][];
  try {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    const isPdf = String.fromCharCode(...head) === '%PDF-';
    pages = isPdf ? await readPdf(new Uint8Array(await file.arrayBuffer()), progress) : await readImage(file);
  } catch {
    throw new UploadFailure('unreadable');
  }
  const symbols: UploadSymbol[] = [];
  let lineCount = 0;
  for (const page of pages) {
    await pause();
    for (const line of splitLines(page)) {
      const groups = await symbolsOf(line);
      for (const group of groups) {
        if (symbols.length >= MAX_SYMBOLS) break;
        symbols.push({
          id: symbols.length,
          strokes: group.strokes,
          rect: rectOf(group.strokes),
          line: lineCount,
          role: group.role,
          known: group.known,
        });
      }
      lineCount += 1;
    }
  }
  if (symbols.length === 0) throw new UploadFailure('nothing');
  return { symbols, lines: lineCount };
}

/** Reads a symbol with the on-device handwriting recognizer: the text, or '' when it can't. */
export async function readSymbol(symbol: UploadSymbol, ask: boolean): Promise<string | 'off'> {
  try {
    const intel = await import('../../../intel').then((module) => module.loadApi());
    await intel.loadIntel();
    const on = ask ? await intel.askToTurnOn('handwriting') : intel.isOn('handwriting');
    if (!on) return 'off';
    const read = intel.readWith(intel.intelClient);
    const text = await read(
      symbol.strokes.map((stroke, i) => ({ key: String(i), points: stroke.map((p) => [p.x, p.y] as const) })),
    );
    return text ?? '';
  } catch {
    return '';
  }
}

/** The file as base64, for keeping it with the style. */
export async function base64Of(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
