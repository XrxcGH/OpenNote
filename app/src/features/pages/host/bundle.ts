// Printing the pages of a section or notebook for a PDF export (A1-12). Each page goes through the same hidden print
// window as a page's own "Export as PDF" (ADR 0006), one at a time, and its file goes to the host under the export's
// job name. The host's export then writes the folders, the files, and an index.html. A page that can't be printed is
// left out, and the export's report says so; the rest still export.
import { decodeRecords } from '../../../core/ink/codec';
import type { InteropClient } from '../../../platform/interop';
import type { ExportsClient, PagesClient } from '../../../platform/types';
import { exportStrokes, readExportPage } from '../export';
import { toBase64 } from './base64';
import { createPrintSurface, newJobId, prepareInput } from './exporter';
import type { PageSource } from './source';
import { exportPdf } from '../pdf';

export interface BundleSection {
  readonly title: string;
  readonly pages: readonly { readonly ui: string; readonly title: string }[];
}

export interface DrawBundleOptions {
  readonly pages: PagesClient;
  readonly exports: ExportsClient;
  readonly interop: Pick<InteropClient, 'more'>;
  /** The export's job name; the host takes the files under it. */
  readonly job: string;
  readonly notebook: string;
  readonly sections: readonly BundleSection[];
  /** The shown page as the window has it, so typing the core hasn't saved yet is in the file. */
  readonly shown?: (pageId: string) => Promise<PageSource | null>;
  readonly signal?: AbortSignal;
  /** Called before each page prints, with how many are done. */
  readonly onPage?: (done: number, total: number, title: string) => void;
}

export interface DrawnBundle {
  readonly drawn: number;
  readonly failed: number;
}

/** The page as export data, opened from the core with its handwriting. */
async function sourceOf(pages: PagesClient, id: string, title: string, notebook: string, section: string) {
  const open = await pages.open(id as never, { viewport: null });
  try {
    let strokes: ReturnType<typeof exportStrokes> = [];
    if (open.ink) {
      try {
        strokes = exportStrokes(decodeRecords(await open.ink.readAll(), { verify: false }));
      } catch {
        // Ink that can't be read prints as a page without it.
      }
    }
    const page = readExportPage({ ...open.initial, title }, strokes, 'en');
    const assetUrls: Record<string, string> = {};
    for (const asset of Object.keys(page.assets)) assetUrls[asset] = open.assetUrl(asset as never);
    const source: PageSource = { pageId: id, title, notebook, section, page, assetUrls };
    return source;
  } finally {
    await open.close().catch(() => undefined);
  }
}

const stopped = () => new DOMException('The export was stopped.', 'AbortError');

/**
 * Prints every page and hands each file to the host. Rejects with an `AbortError` when stopped, after telling the
 * host to drop what it has.
 */
export async function drawBundle(options: DrawBundleOptions): Promise<DrawnBundle> {
  const { interop, job, signal } = options;
  const more = interop.more;
  if (!more) throw new Error('This copy of OpenNote cannot export PDF files.');
  const total = options.sections.reduce((n, section) => n + section.pages.length, 0);
  let done = 0;
  let failed = 0;
  try {
    for (const section of options.sections) {
      for (const entry of section.pages) {
        if (signal?.aborted) throw stopped();
        options.onPage?.(done, total, entry.title);
        try {
          const source =
            (await options.shown?.(entry.ui)) ??
            (await sourceOf(options.pages, entry.ui, entry.title, options.notebook, section.title));
          const result = await exportPdf(createPrintSurface(options.exports, newJobId()), {
            input: prepareInput({ ...source, title: entry.title }, {}),
            signal,
          });
          await more('pdf_stage', { job, page: entry.ui, data: toBase64(result.bytes) });
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
          failed += 1;
        }
        done += 1;
      }
    }
  } catch (error) {
    await more('pdf_unstage', { job }).catch(() => undefined);
    throw error;
  }
  return { drawn: done - failed, failed };
}
