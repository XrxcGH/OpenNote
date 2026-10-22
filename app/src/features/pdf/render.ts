// Drawing PDF pages with pdf.js inside the webview (ADR 0041). A PDF from elsewhere is untrusted, so it is parsed here,
// in the browser engine's sandbox and pdf.js's own worker, never by native code. The reader runs with the safe
// choices: no scripting, no XFA forms, no WebAssembly (the page's security policy blocks it), and nothing fetched,
// since the file arrives as bytes. Each page becomes a PNG drawn at twice its size, its words with their boxes, its
// plain text, and the boxes of the pictures on it.
import { cleanBox, imageBoxes, MAX_WORDS, textOfWords, wordsOfRun } from './model';
import type { Box, StoredWord } from './model';

/** The biggest PDF file read, and the most pages taken from one file. */
export const MAX_PDF_BYTES = 200 * 1024 * 1024;
export const MAX_PDF_PAGES = 500;
/** Page units per PDF point: a page shows at its printed size (96 units an inch, 72 points an inch). */
export const UNITS_PER_POINT = 96 / 72;
/** The picture is drawn at twice the size it shows, so it stays sharp when zoomed and printed. */
export const PICTURE_SCALE = 2;
/** The most pixels in one page picture, so a huge page can't use up memory. */
export const MAX_PICTURE_PIXELS = 16_000_000;

type PdfJs = typeof import('pdfjs-dist');
type PdfDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

let loading: Promise<PdfJs> | null = null;

/** pdf.js, loaded on first use with its worker, which is part of the app and not fetched from elsewhere. */
export function pdfjs(): Promise<PdfJs> {
  loading ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
    ([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    },
  );
  return loading;
}

export class PdfError extends Error {
  constructor(readonly code: 'tooBig' | 'unreadable' | 'locked' | 'empty') {
    super(code);
  }
}

/** One drawn page. Sizes are in PDF points. */
export interface DrawnPage {
  page: number;
  width: number;
  height: number;
  png: Blob;
  words: StoredWord[];
  text: string;
  images: Box[];
}

export interface PdfFile {
  pages: number;
  draw(page: number): Promise<DrawnPage>;
  close(): Promise<void>;
}

/** Opens a PDF from its bytes. Rejects with PdfError for a file that is too big, damaged, or locked with a password. */
export async function openPdf(bytes: Uint8Array): Promise<PdfFile> {
  if (bytes.byteLength > MAX_PDF_BYTES) throw new PdfError('tooBig');
  const lib = await pdfjs();
  let doc: PdfDocument;
  try {
    doc = await lib.getDocument({
      data: bytes,
      enableXfa: false,
      useWasm: false,
      useSystemFonts: true,
      stopAtErrors: false,
      maxImageSize: MAX_PICTURE_PIXELS,
      disableAutoFetch: true,
      disableStream: true,
      verbosity: 0,
    }).promise;
  } catch (error) {
    throw new PdfError((error as { name?: string }).name === 'PasswordException' ? 'locked' : 'unreadable');
  }
  if (doc.numPages < 1) throw new PdfError('empty');
  return {
    pages: Math.min(doc.numPages, MAX_PDF_PAGES),
    draw: (page) => drawPage(lib, doc, page),
    close: () => doc.loadingTask.destroy(),
  };
}

async function drawPage(lib: PdfJs, doc: PdfDocument, number: number): Promise<DrawnPage> {
  const page = await doc.getPage(number);
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(PICTURE_SCALE * UNITS_PER_POINT, Math.sqrt(MAX_PICTURE_PIXELS / (base.width * base.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvas, viewport }).promise;
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new PdfError('unreadable'))), 'image/png'),
    );
    canvas.width = 0;
    const words = await pageWords(lib, page, base);
    const ops = await page.getOperatorList();
    const images = imageBoxes(ops, lib.OPS, base.transform, base);
    return { page: number, width: base.width, height: base.height, png, words, text: textOfWords(words), images };
  } finally {
    page.cleanup();
  }
}

type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;
type Viewport = ReturnType<PdfPage['getViewport']>;

/** The page's words, each with its box as fractions of the page. */
async function pageWords(lib: PdfJs, page: PdfPage, viewport: Viewport): Promise<StoredWord[]> {
  const content = await page.getTextContent();
  const words: StoredWord[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const m = lib.Util.transform(viewport.transform, item.transform) as number[];
    const size = Math.hypot(m[2], m[3]);
    const width = item.width * viewport.scale;
    const box = cleanBox(
      m[4] / viewport.width,
      (m[5] - size) / viewport.height,
      width / viewport.width,
      (size * 1.2) / viewport.height,
    );
    if (box) words.push(...wordsOfRun(item.str, box));
    if (words.length >= MAX_WORDS) break;
  }
  return words.slice(0, MAX_WORDS);
}
