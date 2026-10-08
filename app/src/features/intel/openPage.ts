// Opens a page by its ID, from a list of results. The location needs the notebook and section above the page, which the
// notes service knows.
import { navigate } from '../../app/location';
import type { Location } from '../../app/location';
import { commandContext } from '../../commands/registry';
import type { NodeId } from '../../services/notes/types';

export async function locationOfPage(pageId: string): Promise<Location | null> {
  const { notes } = commandContext('menu');
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
export async function openPageById(pageId: string): Promise<boolean> {
  const to = await locationOfPage(pageId);
  if (!to) return false;
  navigate(to, { focus: 'target' });
  return true;
}
