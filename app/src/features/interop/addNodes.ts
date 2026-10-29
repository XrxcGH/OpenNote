// Turns an imported notebook into tree nodes. A host that keeps the notes in the notes folder has put the notebook
// in the tree already, so its nodes are looked up. Otherwise (the web platform's memory notes) each section and page
// of the import gets a node, and the host is told which imported page holds the content of each page node.

import type { ChipColor, NodeId, NodeSummary, NotesService, PageLevel } from '../../services/notes/types';
import { CHIP_COLORS, NOTES_LIMITS } from '../../services/notes/types';
import type { ImportedTree } from '../../platform/interop';

export interface AddedNodes {
  notebook: NodeSummary;
  firstSection: NodeSummary | null;
  firstPage: NodeSummary | null;
  /** Each page node and the imported page behind it, for `interop.adopt`. */
  pairs: { ui: string; core: string }[];
}

/** The nodes of a notebook the host put in the notes tree: its IDs are the tree's own. */
export async function findImportedNodes(notes: NotesService, tree: ImportedTree): Promise<AddedNodes> {
  const node = async (id: string | undefined) => (id ? notes.get(id as NodeId) : null);
  const notebook = await node(tree.notebookId);
  if (!notebook) throw new Error('The imported notebook is not in the notes.');
  const section = await node(tree.sections[0]?.id);
  const first = tree.sections.flatMap((one) => one.pages)[0];
  const page = await node(first?.core);
  return { notebook, firstSection: section, firstPage: page, pairs: [] };
}

/** A title the service accepts, or undefined for its own default. */
function titleOf(title: string): string | undefined {
  const trimmed = title.trim().slice(0, NOTES_LIMITS.titleLength).trim();
  return trimmed === '' ? undefined : trimmed;
}

function chipOf(color: string | null): ChipColor | null {
  return CHIP_COLORS.find((chip) => chip === color) ?? null;
}

/**
 * Makes a notebook, its sections, and its pages in the notes service, in the imported order. A failure part
 * way moves the half-made notebook to the Trash and rethrows, so the tree never shows half an import.
 */
export async function addImportedNodes(notes: NotesService, tree: ImportedTree): Promise<AddedNodes> {
  const notebook = await notes.create({
    kind: 'notebook',
    placement: { parentId: null, beforeId: null },
    title: titleOf(tree.title),
    color: chipOf(tree.color),
  });
  const added: AddedNodes = { notebook, firstSection: null, firstPage: null, pairs: [] };
  try {
    for (const section of tree.sections) {
      const node = await notes.create({
        kind: 'section',
        placement: { parentId: notebook.id, beforeId: null },
        title: titleOf(section.title),
        color: chipOf(section.color),
      });
      added.firstSection ??= node;
      let previous = -1;
      for (const page of section.pages) {
        // A subpage needs a page above it, and there are only two levels of subpages.
        const level = Math.max(0, Math.min(page.level, previous + 1, NOTES_LIMITS.pageLevel)) as PageLevel;
        const created = await notes.create({
          kind: 'page',
          placement: { parentId: node.id, beforeId: null },
          title: titleOf(page.title),
          pageLevel: level,
        });
        previous = level;
        added.firstPage ??= created;
        added.pairs.push({ ui: created.id, core: page.core });
      }
    }
  } catch (error) {
    await notes.trash([notebook.id]).catch(() => undefined);
    throw error;
  }
  return added;
}
