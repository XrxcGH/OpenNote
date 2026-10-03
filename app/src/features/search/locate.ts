// Opening a page by its ID: the location needs the notebook and section above it, which the notes service knows.
import { navigate } from '../../app/location';
import type { Location } from '../../app/location';
import type { NodeId, NotesService } from '../../services/notes/types';

export async function locationOfPage(notes: NotesService, pageId: string): Promise<Location | null> {
  const page = await notes.get(pageId as NodeId);
  if (!page || page.kind !== 'page') return null;
  let sectionId: NodeId | null = null;
  let notebookId: NodeId | null = null;
  let parent = page.parentId;
  for (let depth = 0; parent && depth < 12; depth += 1) {
    const node = await notes.get(parent);
    if (!node) break;
    if (node.kind === 'section' && !sectionId) sectionId = node.id;
    if (node.kind === 'notebook') {
      notebookId = node.id;
      break;
    }
    parent = node.parentId;
  }
  return { view: 'workspace', notebookId, sectionId, pageId: page.id };
}

/** Opens the page. Resolves false when the tree no longer has it. */
export async function openPage(notes: NotesService, pageId: string): Promise<boolean> {
  const to = await locationOfPage(notes, pageId);
  if (!to) return false;
  navigate(to, { focus: 'target' });
  return true;
}
