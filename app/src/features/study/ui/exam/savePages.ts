// Saving exam pages from the window: the notebook's Practice exams section, through the notes, and page services.
import { commandContext } from '../../../../commands/registry';
import type { NodeId } from '../../../../services/notes';
import type { JsonPatch } from '../../../../services/pages/types';
import { examSection, patchPageView, writePage } from '../../exam/save';
import type { PageExtras } from '../../exam/save';

/** Saves pages in the notebook's Practice exams section. Returns the new pages' ids, or null when none could be. */
export async function savePages(
  notebookId: string | null,
  pages: ({ title: string; markdown: string } & PageExtras)[],
): Promise<string[] | null> {
  if (!notebookId) return null;
  const ctx = commandContext('palette');
  const section = await examSection(ctx.notes, notebookId as NodeId, true);
  if (!section) return null;
  const ids: string[] = [];
  for (const page of pages)
    ids.push((await writePage(ctx.notes, ctx.platform.pages, section.id, page.title, page.markdown, page)).id);
  return ids;
}

/** Merges a patch into a saved page's view, such as the exam on a paper saved before it was handed in. */
export const patchSavedPage = (pageId: string, view: JsonPatch) =>
  patchPageView(commandContext('palette').platform.pages, pageId, view);

/**
 * The exams whose blank paper is saved already, so saving the results does not save it again, with the paper's
 * page (null when it is not known) so the results can put the exam on it too.
 */
export const savedPapers = new Map<string, string | null>();
