// What the Tags pane writes: a checkbox checked off in place, and a summary page saved from the groups.
import { newId } from '../../../editor/ids';
import type { PagesClient } from '../../../platform/types';
import type { NodeId, NodeSummary, NotesService } from '../../../services/notes/types';
import { t } from '../../../strings/t';
import { setTaskBox } from './summary';
import type { TaggedLine } from './summary';

/** Checks a line's box or opens it again. A To do tag keeps its state in the block data, a task item in its text. */
export async function setLineBox(pages: PagesClient, line: TaggedLine, done: boolean): Promise<void> {
  const open = await pages.open(line.page, { viewport: null });
  try {
    const block = open.initial.blocks.find((candidate) => candidate.id === line.block);
    if (!block) throw new Error('The block is gone.');
    if (line.boxKind === 'tag' && line.element) {
      const held = Array.isArray(block.data.checked) ? (block.data.checked as string[]) : [];
      const checked = new Set(held);
      if (done) checked.add(line.element);
      else checked.delete(line.element);
      await open.send({ edits: [{ edit: 'patchBlock', block: block.id, data: { checked: [...checked].sort() } }] });
    } else if (line.boxKind === 'task') {
      const markdown = typeof block.data.markdown === 'string' ? block.data.markdown : '';
      const next = setTaskBox(markdown, line.taskIndex, done);
      if (next === null) throw new Error('The task moved.');
      await open.send({ edits: [{ edit: 'setText', block: block.id, markdown: next }] });
    }
  } finally {
    await open.close();
  }
}

async function firstSection(notes: NotesService): Promise<NodeId | null> {
  for (const notebook of await notes.listNotebooks()) {
    const section = (await notes.listChildren(notebook.id)).find((node) => node.kind === 'section');
    if (section) return section.id;
  }
  return null;
}

/** Saves the Markdown as a new page in the section, or in the first section there is. */
export async function createSummaryPage(
  notes: NotesService,
  pages: PagesClient,
  section: NodeId | null,
  markdown: string,
): Promise<NodeSummary> {
  const parentId = section ?? (await firstSection(notes));
  if (!parentId) throw new Error('There is no section for the page.');
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const title = t('qolSearch.tagsPane.summaryTitle', { date });
  const page = await notes.create({ kind: 'page', placement: { parentId, beforeId: null }, title });
  const open = await pages.open(page.id, { viewport: null });
  try {
    await open.send({ edits: [{ edit: 'insertBlock', block: { id: newId(), type: 'text', data: { markdown } } }] });
  } finally {
    await open.close();
  }
  return page;
}
