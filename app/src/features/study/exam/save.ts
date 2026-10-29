// Saving a practice exam (ADR 0052): pages in the notebook's "Practice exams" section, made when it is first needed.
// The paper and the key are separate pages, so the blank paper prints without its answers; the results are a third
// page. Each is an ordinary page, so it syncs, searches, prints, and exports through the usual paths.
import type { NodeId, NodeSummary, NotesService } from '../../../services/notes';
import type { PageService } from '../../../services/pages/types';
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

/** Makes a page in the section with one text block of Markdown. */
export async function writePage(
  notes: Pick<NotesService, 'create'>,
  pages: Pick<PageService, 'open'>,
  section: NodeId,
  title: string,
  markdown: string,
): Promise<NodeSummary> {
  const page = await notes.create({
    kind: 'page',
    placement: { parentId: section, beforeId: null },
    title: title.slice(0, 200),
  });
  const open = await pages.open(page.id, { viewport: null });
  try {
    await open.send({ edits: [{ edit: 'insertBlock', block: { id: newId(), type: 'text', data: { markdown } } }] });
  } finally {
    await open.close().catch(() => undefined);
  }
  return page;
}
