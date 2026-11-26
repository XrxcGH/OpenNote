// @vitest-environment node
// Restore from the Trash view joins the tree's undo stack (full walk A-A02-13).

import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryNotesService } from '../../services/notes/memory';
import type { MemoryNotesService } from '../../services/notes/memory';
import type { NodeId } from '../../services/notes';
import { resetStores } from '../../state/store';
import { startTree, stopTree, undoStore } from '../tree';
import { restoreTrashItem } from './restore';

const id = (value: string) => value as NodeId;
let notes: MemoryNotesService;
const pages = async () => (await notes.listChildren(id('s-lectures'))).map((page) => page.id);

beforeEach(async () => {
  resetStores();
  stopTree();
  notes = createMemoryNotesService({ seed: 'sample' });
  await startTree(notes);
});

describe('restoreTrashItem', () => {
  it('puts the restore on the undo stack, so it can be undone and redone', async () => {
    const page = id('p-cell-structure');
    await notes.trash([page]);
    expect(await pages()).not.toContain(page);
    expect(await restoreTrashItem(notes, page)).toBe(true);
    expect(await pages()).toContain(page);
    const entry = undoStore.get().past.at(-1);
    expect(entry?.undone).toMatch(/to Trash again/);
    await entry?.undo(notes);
    expect(await pages()).not.toContain(page);
    await entry?.redo(notes);
    expect(await pages()).toContain(page);
  });
});
