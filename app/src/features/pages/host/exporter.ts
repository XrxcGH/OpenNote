// The export jobs the commands run: PDF through the hidden print window, and Markdown and HTML files. Each picks the
// file with the Save dialog first, so nothing is made for a save the person cancels, then makes it, then writes it.
// All of them take the platform's `exports` client, so the web platform runs the same code with its stand-ins.
import type { ExportsClient } from '../../../platform/types';
import { formatDate } from '../../../strings/format';
import { t } from '../../../strings/t';
import {
  ENGLISH_LABELS,
  dataUri,
  exportHtml,
  exportMarkdown,
  hasInk,
  inkExtent,
  inkShapes,
  inkSvg,
  lightTheme,
} from '../export';
import type { ExportLabels } from '../export';
import { exportFileName, exportPdf } from '../pdf';
import type { PdfExportResult, PdfProblem, PdfProgress, PrintSurface } from '../pdf';
import type { PrepareInput, PrepareResult, PrintOptions } from '../print';
import { bundledFontFaces } from './fonts';
import type { PageSource } from './source';

/** The words an export writes itself, from the app's strings. */
export function exportLabels(): ExportLabels {
  return {
    ...ENGLISH_LABELS,
    handwriting: t('pageViews.print.handwriting'),
    untitled: t('pageViews.print.untitled'),
  };
}

let counter = 0;
/** A name for one export job, safe as part of a window label. */
export function newJobId(): string {
  counter += 1;
  return `j${Date.now().toString(36)}${counter}`;
}

/** The print surface of the desktop app: the hidden window, driven through the shell. */
export function createPrintSurface(client: ExportsClient, job: string): PrintSurface {
  let box: { width: number; height: number } | null = null;
  return {
    async prepare(input) {
      const result = (await client.printPrepare(job, input)) as PrepareResult;
      box = result.plan.box;
      return result;
    },
    async toPdf(options) {
      if (!box) throw new Error('Prepare the page before printing it.');
      const inches = { width: box.width / 96, height: box.height / 96 };
      return client.printRender(job, inches, options.background, { tagged: options.tagged, outline: options.outline });
    },
    dispose: () => client.printClose(job),
  };
}

export interface PdfExportOptions {
  readonly print: PrintOptions;
  /** Writes structure tags, a language, alt text, and bookmarks through the DevTools route. */
  readonly accessible?: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: PdfProgress) => void;
}

/** The input the print window prepares: the page, its assets, the light theme with the app's fonts, and the options. */
export function prepareInput(source: PageSource, print: PrintOptions): PrepareInput {
  return {
    page: source.page,
    assetUrls: source.assetUrls,
    theme: lightTheme(bundledFontFaces()),
    labels: exportLabels(),
    print: {
      ...print,
      fields: {
        title: source.title,
        notebook: source.notebook,
        section: source.section,
        date: formatDate(new Date().toISOString()),
        ...print.fields,
      },
    },
  };
}

export type PdfOutcome =
  | { readonly status: 'canceled' }
  | {
      readonly status: 'saved';
      readonly path: string;
      readonly name: string;
      readonly sheets: number;
      readonly problems: readonly PdfProblem[];
    };

/** What went wrong with a PDF the job made: the errors the check found. Nothing was saved. */
export class PdfCheckError extends Error {
  constructor(readonly problems: readonly PdfProblem[]) {
    super(problems.map((problem) => problem.detail).join(' '));
    this.name = 'PdfCheckError';
  }
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * Exports the page to a PDF the person names. Resolves with `canceled` when the Save dialog is canceled. Rejects with
 * an `AbortError` when stopped, a `TimeoutError` when a step takes too long, a `PdfCheckError` when the file does not
 * match the plan, and the shell's error otherwise.
 */
export async function exportPdfFile(
  client: ExportsClient,
  source: PageSource,
  options: PdfExportOptions,
): Promise<PdfOutcome> {
  const suggested = exportFileName(source.title || t('pageViews.print.untitled'), 'pdf');
  const path = await client.pickSave({ suggested, label: t('pageViews.files.pdfLabel'), extension: 'pdf' });
  if (path === null) return { status: 'canceled' };
  const job = newJobId();
  const result: PdfExportResult = await exportPdf(createPrintSurface(client, job), {
    input: prepareInput(source, options.print),
    // WebView2's PrintToPdf writes neither structure tags nor bookmarks (ADR 0006), so an accessible PDF goes through
    // the DevTools route, and the check below says when the file still has no tags.
    tagged: options.accessible === true,
    outline: options.accessible === true,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  const errors = result.problems.filter((problem) => problem.severity === 'error');
  if (errors.length > 0) throw new PdfCheckError(errors);
  await client.write(path, [{ path: '', bytes: result.bytes }]);
  return {
    status: 'saved',
    path,
    name: baseName(path),
    sheets: result.prepared.printed,
    problems: result.problems,
  };
}

export type TextOutcome =
  { readonly status: 'canceled' } | { readonly status: 'saved'; readonly path: string; readonly name: string };

/** An asset's bytes, or null when it can't be read. */
async function assetBytes(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** The page's handwriting as one SVG picture, or null when it has none. */
export function pageInkSvg(source: PageSource): string | null {
  const { page } = source;
  const origins = new Map(
    page.blocks
      .filter((block) => block.type === 'ink')
      .map((block) => [block.id, { x: block.frame?.x ?? 0, y: block.frame?.y ?? 0 }] as const),
  );
  const shapes = inkShapes(page.strokes, [...origins.keys()], origins);
  const extent = inkExtent(shapes);
  if (!extent) return null;
  const width = Math.ceil(extent.x + extent.w + 16);
  const height = Math.ceil(extent.y + extent.h + 16);
  return inkSvg(shapes, 0, width, height, t('pageViews.print.handwriting'));
}

/** A name without its extension, for the folder that holds a Markdown file's pictures. */
function stemOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Exports the page as a Markdown file, with its pictures in a folder beside it. */
export async function exportMarkdownFile(client: ExportsClient, source: PageSource): Promise<TextOutcome> {
  const suggested = exportFileName(source.title || t('pageViews.print.untitled'), 'md');
  const path = await client.pickSave({ suggested, label: t('pageViews.files.markdownLabel'), extension: 'md' });
  if (path === null) return { status: 'canceled' };
  const folder = `${stemOf(path)}_files`;
  const ink = hasInk(source.page) ? pageInkSvg(source) : null;
  const made = exportMarkdown(source.page, {
    frontMatter: 'basic',
    assetPath: (_id, file) => `${folder}/${file}`,
    handwriting: ink ? `![${t('pageViews.print.handwriting')}](${encodeURIComponent(folder)}/ink.svg)` : null,
  });
  const encoder = new TextEncoder();
  const files: { path: string; bytes: Uint8Array }[] = [{ path: '', bytes: encoder.encode(made.markdown) }];
  for (const id of made.assets) {
    const url = source.assetUrls[id];
    const file = source.page.assets[id]?.file;
    const bytes = url && file ? await assetBytes(url) : null;
    if (bytes && file) files.push({ path: `${folder}/${file}`, bytes });
  }
  if (ink) files.push({ path: `${folder}/ink.svg`, bytes: encoder.encode(ink) });
  await client.write(path, files);
  return { status: 'saved', path, name: baseName(path) };
}

/** Exports the page as one web page file that holds its pictures inside it. */
export async function exportHtmlFile(client: ExportsClient, source: PageSource): Promise<TextOutcome> {
  const suggested = exportFileName(source.title || t('pageViews.print.untitled'), 'html');
  const path = await client.pickSave({ suggested, label: t('pageViews.files.htmlLabel'), extension: 'html' });
  if (path === null) return { status: 'canceled' };
  const uris = new Map<string, string>();
  await Promise.all(
    Object.values(source.page.assets).map(async (asset) => {
      const url = source.assetUrls[asset.id];
      const bytes = url ? await assetBytes(url) : null;
      if (bytes) uris.set(asset.id, dataUri(asset.mime, bytes));
    }),
  );
  // A web page file carries its own pictures, and reads in the reader's fonts: the app's font files aren't beside it.
  const made = exportHtml(source.page, {
    assetUrl: (asset) => uris.get(asset.id) ?? null,
    theme: lightTheme(),
    labels: exportLabels(),
  });
  await client.write(path, [{ path: '', bytes: new TextEncoder().encode(made.html) }]);
  return { status: 'saved', path, name: baseName(path) };
}
