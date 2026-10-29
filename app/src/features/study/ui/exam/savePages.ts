// Saving exam pages from the window: the notebook's Practice exams section, through the notes, and page services.
import { commandContext } from '../../../../commands/registry';
import type { NodeId } from '../../../../services/notes';
import { examSection, writePage } from '../../exam/save';

/** Saves pages in the notebook's Practice exams section. Returns how many were saved, or null when none could be. */
export async function savePages(notebookId: string | null, pages: { title: string; markdown: string }[]) {
  if (!notebookId) return null;
  const ctx = commandContext('palette');
  const section = await examSection(ctx.notes, notebookId as NodeId, true);
  if (!section) return null;
  for (const page of pages) await writePage(ctx.notes, ctx.platform.pages, section.id, page.title, page.markdown);
  return pages.length;
}

/** The exams whose blank paper is saved already, so saving the results does not save it again. */
export const savedPapers = new Set<string>();
