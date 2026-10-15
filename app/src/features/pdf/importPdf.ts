// Bringing a PDF in (A4-10): as new pages in the open section, one for each PDF page, or into the open page, one
// page below the other. Each PDF page becomes a picture locked in place, so ink and typed notes sit on it and stay
// where they were put. The page's words go with it, for selecting text, highlights, and search.
import { getLocation } from '../../app/location';
import { newId } from '../../editor/ids';
import type { Platform } from '../../platform/types';
import type { NodeId, NotesService } from '../../services/notes/types';
import type { Edit, ImportedAsset, NewBlock } from '../../services/pages/types';
import { t } from '../../strings/t';
import { showToast } from '../../ui';
import { readBytes } from './pick';
import { MAX_PDF_BYTES, openPdf, PdfError, UNITS_PER_POINT } from './render';
import type { DrawnPage, PdfFile } from './render';
import { importedLayerEdit } from '../ink';
import { closedTarget } from './target';
import type { EditTarget } from './target';

/** Space between pages stacked in one page, in page units. */
const GAP = 24;

/** The image block for one drawn PDF page at `x`, `y`. */
export function pdfPageBlock(
  asset: ImportedAsset,
  drawn: Pick<DrawnPage, 'page' | 'width' | 'height' | 'words' | 'text' | 'images'>,
  file: { name: string; pages: number },
  at: { x: number; y: number },
): NewBlock {
  return {
    id: newId() as never,
    type: 'image',
    lock: 'position',
    frame: { x: at.x, y: at.y, w: drawn.width * UNITS_PER_POINT, h: drawn.height * UNITS_PER_POINT },
    data: {
      asset: asset.id,
      alt: t('pdf.pageAlt', { page: drawn.page, pages: file.pages, file: file.name }),
      background: 'pdf',
      pdf: { file: file.name, page: drawn.page, pages: file.pages },
      words: drawn.words,
      images: drawn.images,
      text: drawn.text,
    },
  };
}

/** A title for the page made from one PDF page: the file's name without `.pdf`, and the page number. */
export function pageTitle(name: string, page: number, pages: number): string {
  const stem = name.replace(/\.pdf$/i, '') || name;
  return pages === 1 ? stem : t('pdf.pageTitle', { file: stem, page });
}

function failure(error: unknown, name: string): string {
  const code = error instanceof PdfError ? error.code : 'unreadable';
  return t(`pdf.errors.${code}`, { name });
}

interface Progress {
  stopped: boolean;
  update(done: number, total: number): void;
  finish(message: string, tone?: 'danger'): void;
}

function progress(name: string): Progress {
  const state: Progress = {
    stopped: false,
    update(done, total) {
      showToast({
        id: 'pdf-import',
        message: t('pdf.progress', { done, total, name }),
        action: { label: t('pdf.stop'), run: () => void (state.stopped = true) },
      });
    },
    finish(message, tone) {
      showToast({ id: 'pdf-import', message, ...(tone ? { tone } : {}) });
    },
  };
  return state;
}

async function open(file: File): Promise<PdfFile> {
  const bytes = await readBytes(file, MAX_PDF_BYTES);
  if (!bytes) throw new PdfError('tooBig');
  return openPdf(bytes);
}

async function imported(page: Pick<EditTarget, 'importImage'>, drawn: DrawnPage, name: string): Promise<ImportedAsset> {
  const bytes = await drawn.png.arrayBuffer();
  return page.importImage({ kind: 'bytes', bytes, name: `${name}-${drawn.page}.png`, mime: 'image/png' });
}

/** Makes a page in the open section for each PDF page. Resolves with the first new page, or null. */
export async function importPdfAsPages(platform: Platform, notes: NotesService, file: File): Promise<NodeId | null> {
  const here = getLocation();
  const section = here.view === 'workspace' ? here.sectionId : null;
  if (!section) {
    showToast({ message: t('pdf.needSection') });
    return null;
  }
  const status = progress(file.name);
  let pdf: PdfFile;
  try {
    pdf = await open(file);
  } catch (error) {
    status.finish(failure(error, file.name), 'danger');
    return null;
  }
  let first: NodeId | null = null;
  let made = 0;
  const missed: number[] = [];
  try {
    for (let number = 1; number <= pdf.pages && !status.stopped; number += 1) {
      status.update(number, pdf.pages);
      try {
        const drawn = await pdf.draw(number);
        const node = await notes.create({
          kind: 'page',
          placement: { parentId: section, beforeId: null },
          title: pageTitle(file.name, number, pdf.pages),
        });
        first ??= node.id;
        const page = await platform.pages.open(node.id as never, { viewport: null });
        try {
          const asset = await imported(page, drawn, file.name);
          const block = pdfPageBlock(asset, drawn, { name: file.name, pages: pdf.pages }, { x: 0, y: 0 });
          const layer = importedLayerEdit(page.id, page.initial.view);
          await closedTarget(page).send([
            { edit: 'setPage', view: { layout: 'freeform' } },
            ...(layer ? [layer] : []),
            { edit: 'addAsset', asset: asset.id },
            { edit: 'insertBlock', block },
          ]);
        } finally {
          await page.close().catch(() => undefined);
        }
        made += 1;
      } catch {
        missed.push(number);
      }
    }
  } finally {
    await pdf.close().catch(() => undefined);
  }
  status.finish(
    missed.length > 0
      ? t('pdf.importedSome', { count: made, name: file.name, missed: missed.join(', ') })
      : t('pdf.imported', { count: made, name: file.name }),
  );
  return first;
}

/** Puts every PDF page into the shown page, one below the other, as one step that one undo takes back. */
export async function insertPdfIntoPage(page: EditTarget, file: File, top: number): Promise<number> {
  const status = progress(file.name);
  let pdf: PdfFile;
  try {
    pdf = await open(file);
  } catch (error) {
    status.finish(failure(error, file.name), 'danger');
    return 0;
  }
  const edits: Edit[] = [];
  let y = top;
  let made = 0;
  try {
    for (let number = 1; number <= pdf.pages && !status.stopped; number += 1) {
      status.update(number, pdf.pages);
      const drawn = await pdf.draw(number).catch(() => null);
      if (!drawn) continue;
      const asset = await imported(page, drawn, file.name);
      const block = pdfPageBlock(asset, drawn, { name: file.name, pages: pdf.pages }, { x: 0, y });
      edits.push({ edit: 'addAsset', asset: asset.id }, { edit: 'insertBlock', block });
      y += (block.frame?.h ?? 0) + GAP;
      made += 1;
    }
  } finally {
    await pdf.close().catch(() => undefined);
  }
  if (status.stopped || made === 0) {
    status.finish(status.stopped ? t('pdf.stopped') : failure(new PdfError('unreadable'), file.name));
    return 0;
  }
  const layer = importedLayerEdit(page.page.id, page.page.initial.view);
  await page.send(layer ? [layer, ...edits] : edits);
  status.finish(t('pdf.inserted', { count: made, name: file.name }));
  return made;
}

/** The bottom of the lowest block with a frame, so inserted pages go below what is there. */
export function bottomOf(blocks: readonly { frame?: { y?: number; h?: number } }[]): number {
  let bottom = 0;
  for (const block of blocks) {
    const { y, h } = block.frame ?? {};
    if (typeof y === 'number' && typeof h === 'number') bottom = Math.max(bottom, y + h + GAP);
  }
  return bottom;
}
