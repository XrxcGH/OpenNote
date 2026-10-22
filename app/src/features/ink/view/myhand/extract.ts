// Uploads of the person's own handwriting to symbols they can confirm (flag ink.myHandwriting). A PDF's ink is read
// from its drawing as vectors; a page that only holds pictures, and a scan or photo, are traced from their pixels.
// The strokes go into lines and symbols, the math reader's grouping tells bars, roots, integrals, and brackets
// apart, and the on-device handwriting recognizer reads the rest, one symbol at a time.
// Every file is untrusted. Sizes are capped before anything is decoded: bytes, a picture's pixels from its header,
// and a PDF page's drawing size. Every step has a time limit and can be canceled. A file that can't be read gives a
// calm error, never a crash. A read takes whole lines up to a cap and says where it stopped, so nothing is unseen.
import { loadPdfJs, MAX_PICTURE_PIXELS } from '../../../pdf';
import { imageSize } from '../../myhand/imageSize';
import { pageInk } from '../../myhand/pdfInk';
import type { PdfOps } from '../../myhand/pdfInk';
import { groupSymbols, rectOf, splitLines } from '../../myhand/segment';
import type { Rect, WrittenLine } from '../../myhand/segment';
import { inkOf, traceBitmap } from '../../myhand/trace';
import type { Traced } from '../../myhand/trace';

export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
/** The most pages one read takes; the person reads on for more. */
export const MAX_UPLOAD_PAGES = 30;
/** The most pixels a picture is traced at; bigger ones are scaled down first. */
export const MAX_TRACE_PIXELS = 9_000_000;
/** The most pixels a scan or photo may have to be decoded at all (a 50-megapixel photo). */
export const MAX_DECODE_PIXELS = 50_000_000;
/** The longest side of a picture, or of a drawn PDF page, in pixels. */
export const MAX_SIDE = 16_384;
/** The most symbols one read offers to confirm; the person reads on for more. */
export const MAX_SYMBOLS = 1500;
/** How long one step (opening the file, one page) may take before it is given up. */
export const STEP_LIMIT_MS = 30_000;
/** After this long, a read stops at the next page with what it has. */
export const READ_LIMIT_MS = 60_000;

export type UploadError = 'tooBig' | 'tooManyPixels' | 'unreadable' | 'nothing' | 'slow' | 'stopped';

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
  /** The line it is on, counted over this read. */
  readonly line: number;
  /** What the math reader's shapes say it is, before any reading: a bar, a root, an integral, a bracket. */
  readonly role: string;
  /** Known from its shape alone, such as an equals sign. */
  readonly known?: string;
}

/** A place in an upload: the page (from 1) and the line on it (from 0). */
export interface UploadStart {
  readonly page: number;
  readonly line: number;
}

export interface UploadRead {
  readonly symbols: UploadSymbol[];
  /** Lines read. */
  readonly lines: number;
  /** The pages this read went through, and how many the file has. */
  readonly pages: { readonly first: number; readonly last: number; readonly total: number };
  /** Where to read on from, when the file has more than one read takes. */
  readonly next?: UploadStart;
  /** Symbols left out of a single line longer than one read takes. */
  readonly dropped: number;
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
  const scale = Math.min(1, Math.sqrt(MAX_TRACE_PIXELS / (width * height)), MAX_SIDE / width, MAX_SIDE / height);
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
  // A see-through pixel reads as paper: each is laid over white.
  for (let i = 0; i < w * h; i++) {
    const lum = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    const alpha = data[i * 4 + 3] / 255;
    gray[i] = Math.round(lum * alpha + 255 * (1 - alpha));
  }
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

/** A file's pages, read one at a time so a long upload can stop between them. */
interface PageSource {
  readonly total: number;
  page(n: number): Promise<Traced[]>;
  close(): Promise<void>;
}

/** Waits for one step of reading, but no longer than `ms`, and stops at once when the person cancels. */
function limited<T>(work: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadFailure('stopped'));
      return;
    }
    const stop = () => reject(new UploadFailure('stopped'));
    const timer = setTimeout(() => reject(new UploadFailure('slow')), ms);
    signal?.addEventListener('abort', stop, { once: true });
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    });
  });
}

async function pdfSource(bytes: Uint8Array, signal?: AbortSignal): Promise<PageSource> {
  const lib = await loadPdfJs();
  const task = lib.getDocument({
    data: bytes,
    enableXfa: false,
    useWasm: false,
    useSystemFonts: true,
    stopAtErrors: false,
    // A picture inside the PDF is never decoded past the pixel cap.
    maxImageSize: MAX_PICTURE_PIXELS,
    disableAutoFetch: true,
    disableStream: true,
    verbosity: 0,
  });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await limited(task.promise, STEP_LIMIT_MS, signal);
  } catch (error) {
    await task.destroy();
    throw error;
  }
  const ops = opsOf(lib as unknown as { OPS: Record<string, number> });
  return {
    total: doc.numPages,
    page: async (n) => {
      const page = await limited(doc.getPage(n), STEP_LIMIT_MS, signal);
      try {
        const ink = pageInk(
          await limited(page.getOperatorList(), STEP_LIMIT_MS, signal),
          ops,
          page.view as [number, number, number, number],
        );
        if (ink.strokes.length > 0 || !ink.hasPictures) return ink.strokes;
        // A scanned page: draw it, never past the trace cap however large its page box claims to be, and trace it.
        const base = page.getViewport({ scale: 1 });
        const area = base.width * base.height;
        if (!(area > 0 && Number.isFinite(area))) return [];
        const scale = Math.min(2, Math.sqrt(MAX_TRACE_PIXELS / area), MAX_SIDE / base.width, MAX_SIDE / base.height);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        try {
          await limited(page.render({ canvas, viewport }).promise, STEP_LIMIT_MS, signal);
          return tracePicture(canvas, canvas.width, canvas.height).map((s) =>
            s.map((p) => ({ x: p.x / scale, y: p.y / scale, width: p.width / scale })),
          );
        } finally {
          canvas.width = 0;
        }
      } finally {
        page.cleanup();
      }
    },
    close: () => doc.loadingTask.destroy(),
  };
}

/** A scan or photo: its size is read from its header first, and a picture past the caps is never decoded. */
async function imageSource(file: Blob, signal?: AbortSignal): Promise<PageSource> {
  const size = imageSize(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()));
  if (!size) throw new UploadFailure('unreadable');
  if (size.width * size.height > MAX_DECODE_PIXELS || size.width > MAX_SIDE || size.height > MAX_SIDE)
    throw new UploadFailure('tooManyPixels');
  return {
    total: 1,
    page: async () => {
      const bitmap = await limited(createImageBitmap(file), STEP_LIMIT_MS, signal);
      try {
        return tracePicture(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    },
    close: async () => undefined,
  };
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

export interface ReadOptions {
  /** Where to start, to read on after an earlier read. */
  readonly start?: UploadStart;
  readonly signal?: AbortSignal;
  /** A smaller symbol cap for this read (tests); never more than MAX_SYMBOLS. */
  readonly maxSymbols?: number;
}

const failure = (error: unknown) => (error instanceof UploadFailure ? error : new UploadFailure('unreadable'));

/**
 * Reads an upload into symbols, whole lines at a time, up to MAX_SYMBOLS symbols and MAX_UPLOAD_PAGES pages a read.
 * When the file has more, `next` says where to read on, so nothing is left out without the person being told.
 * Throws an UploadFailure for a file it can't use.
 */
export async function readUpload(
  file: File,
  progress: Progress = () => undefined,
  options: ReadOptions = {},
): Promise<UploadRead> {
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadFailure('tooBig');
  const { signal } = options;
  const cap = Math.max(1, Math.min(MAX_SYMBOLS, Math.floor(options.maxSymbols ?? MAX_SYMBOLS)));
  let source: PageSource;
  try {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    const isPdf = String.fromCharCode(...head) === '%PDF-';
    source = isPdf
      ? await pdfSource(new Uint8Array(await file.arrayBuffer()), signal)
      : await imageSource(file, signal);
  } catch (error) {
    throw failure(error);
  }
  const symbols: UploadSymbol[] = [];
  const first = Math.max(1, Math.floor(options.start?.page ?? 1));
  let lineCount = 0;
  let dropped = 0;
  let lastRead = first;
  let next: UploadStart | undefined;
  const began = Date.now();
  try {
    if (first > source.total) throw new UploadFailure('nothing');
    const last = Math.min(source.total, first + MAX_UPLOAD_PAGES - 1);
    pages: for (let n = first; n <= last; n++) {
      if (signal?.aborted) throw new UploadFailure('stopped');
      // A read that runs long stops between pages with what it has, and the person reads on from here.
      if (symbols.length > 0 && Date.now() - began > READ_LIMIT_MS) {
        next = { page: n, line: 0 };
        break;
      }
      progress(n, source.total);
      await pause();
      let strokes: Traced[];
      try {
        strokes = await source.page(n);
      } catch (error) {
        const why = failure(error);
        // A page that can't be read after some symbols were found: keep those, and say where to try again.
        if (why.code === 'stopped' || symbols.length === 0) throw why;
        next = { page: n, line: 0 };
        break;
      }
      const lines = splitLines(strokes);
      for (let l = n === first ? Math.max(0, Math.floor(options.start?.line ?? 0)) : 0; l < lines.length; l++) {
        if (signal?.aborted) throw new UploadFailure('stopped');
        const groups = await symbolsOf(lines[l]);
        if (symbols.length > 0 && symbols.length + groups.length > cap) {
          next = { page: n, line: l };
          break pages;
        }
        // Only a single line with more symbols than one read takes is ever cut, and the cut is counted.
        const fits = groups.slice(0, cap - symbols.length);
        dropped += groups.length - fits.length;
        for (const group of fits)
          symbols.push({
            id: symbols.length,
            strokes: group.strokes,
            rect: rectOf(group.strokes),
            line: lineCount,
            role: group.role,
            known: group.known,
          });
        lineCount += 1;
        lastRead = n;
      }
      lastRead = n;
    }
    if (!next && last < source.total) next = { page: last + 1, line: 0 };
  } catch (error) {
    throw failure(error);
  } finally {
    await source.close().catch(() => undefined);
  }
  if (symbols.length === 0 && !next) throw new UploadFailure('nothing');
  return { symbols, lines: lineCount, pages: { first, last: lastRead, total: source.total }, next, dropped };
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
