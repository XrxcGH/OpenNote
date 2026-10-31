// Saving a practice exam (ADR 0052): pages in the notebook's "Practice exams" section, made when it is first needed.
// The paper and the key are separate pages, so the blank paper prints without its answers; the results are a third
// page. Each is an ordinary page, so it syncs, searches, prints, and exports through the usual paths.
import type { NodeId, NodeSummary, NotesService } from '../../../services/notes';
import type { Edit, JsonPatch, PageService } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { newId } from '../../../editor/ids';

/** The title of the section that holds the exams. */
export const examSectionTitle = (): string => t('exams.section');

/** The notebook's "Practice exams" section, made when `create` is set and the notebook has none. */
export async function examSection(
  notes: Pick<NotesService, 'listChildren' | 'create'>,
  notebook: NodeId,
  create: boolean,
): Promise<NodeSummary | null> {
  const title = examSectionTitle();
  const found = (await notes.listChildren(notebook)).find((node) => node.kind === 'section' && node.title === title);
  if (found || !create) return found ?? null;
  return notes.create({ kind: 'section', placement: { parentId: notebook, beforeId: null }, title });
}

/** A picture to put on a page after its text, with a line of Markdown above it. */
export interface PagePicture {
  label: string;
  alt: string;
  name: string;
  svg: string;
  /** The size it takes on the page. */
  width: number;
  height: number;
}

export interface PageExtras {
  /** Merged into the page's view, such as the exam kept for a retake (stored.ts). */
  view?: JsonPatch;
  pictures?: readonly PagePicture[];
}

/** Makes a page in the section with one text block of Markdown, then its pictures, each under its own label. */
export async function writePage(
  notes: Pick<NotesService, 'create'>,
  pages: Pick<PageService, 'open'>,
  section: NodeId,
  title: string,
  markdown: string,
  extras: PageExtras = {},
): Promise<NodeSummary> {
  const page = await notes.create({
    kind: 'page',
    placement: { parentId: section, beforeId: null },
    title: title.slice(0, 200),
  });
  const open = await pages.open(page.id, { viewport: null });
  try {
    let after = newId();
    const edits: Edit[] = [{ edit: 'insertBlock', block: { id: after, type: 'text', data: { markdown } } }];
    if (extras.view) edits.push({ edit: 'setPage', view: extras.view });
    await open.send({ edits });
    for (const picture of extras.pictures ?? []) {
      const bytes = new TextEncoder().encode(picture.svg);
      const asset = await open.importImage({
        kind: 'bytes',
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        name: picture.name,
        mime: 'image/svg+xml',
      });
      const label = newId();
      const image = newId();
      await open.send({
        edits: [
          { edit: 'insertBlock', block: { id: label, type: 'text', data: { markdown: picture.label } }, after },
          { edit: 'addAsset', asset: asset.id },
          {
            edit: 'insertBlock',
            block: {
              id: image,
              type: 'image',
              frame: { w: picture.width, h: picture.height },
              data: { asset: asset.id, alt: picture.alt },
            },
            after: label,
          },
        ],
      });
      after = image;
    }
  } finally {
    await open.close().catch(() => undefined);
  }
  return page;
}

/** Merges a patch into a saved page's view. Returns false when the page could not be opened or changed. */
export async function patchPageView(pages: Pick<PageService, 'open'>, pageId: string, view: JsonPatch) {
  try {
    const open = await pages.open(pageId, { viewport: null });
    try {
      await open.send({ edits: [{ edit: 'setPage', view }] });
    } finally {
      await open.close().catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}
