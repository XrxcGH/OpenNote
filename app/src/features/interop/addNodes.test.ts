import { describe, expect, it } from 'vitest';
import type { ImportedTree } from '../../platform/interop';
import type { NodeId, NodeSummary, NotesService } from '../../services/notes/types';
import { findImportedNodes } from './addNodes';

const node = (id: string, kind: NodeSummary['kind']) => ({ id, kind, title: id }) as unknown as NodeSummary;

function notesWith(ids: Record<string, NodeSummary>): NotesService {
  return { get: async (id: NodeId) => ids[id] ?? null } as unknown as NotesService;
}

const tree = (notebookId?: string): ImportedTree => ({
  ...(notebookId ? { notebookId } : {}),
  dir: 'C:/Notes/Keep',
  title: 'Keep',
  color: null,
  sections: [{ id: 's-1', title: 'Notes', color: null, pages: [{ core: 'p-1', title: 'Groceries', level: 0 }] }],
});

describe('findImportedNodes', () => {
  it('finds the notebook, its first section, and its first page by the tree IDs the host gave', async () => {
    const notes = notesWith({
      'n-1': node('n-1', 'notebook'),
      's-1': node('s-1', 'section'),
      'p-1': node('p-1', 'page'),
    });
    const found = await findImportedNodes(notes, tree('n-1'));
    expect([found.notebook.id, found.firstSection?.id, found.firstPage?.id]).toEqual(['n-1', 's-1', 'p-1']);
    expect(found.pairs).toEqual([]);
  });

  it('says so when the notebook is not in the notes', async () => {
    await expect(findImportedNodes(notesWith({}), tree('n-1'))).rejects.toThrow('not in the notes');
    await expect(findImportedNodes(notesWith({}), tree())).rejects.toThrow('not in the notes');
  });
});
