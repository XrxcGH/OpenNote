// @vitest-environment node
// Pin moves a top-level page above its siblings, and leaves a subpage and a pin without the service alone.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetFakeShell, setFakeShell } from '../../platform/shellqol';
import { createMemoryNotesService } from '../../services/notes/memory';
import type { MemoryNotesService } from '../../services/notes/memory';
import type { NodeId } from '../../services/notes';
import { resetStores } from '../../state/store';
import { ensureChildren, startTree, stopTree } from './load';
import { setPinned } from './qolActions';
import { getNode, treeStore } from './store';

const id = (value: string) => value as NodeId;
const titles = async () => (await notes.listChildren(id('s-lectures'))).map((page) => page.title);
let notes: MemoryNotesService;

beforeEach(async () => {
  resetStores();
  stopTree();
  notes = createMemoryNotesService({ seed: 'sample' });
  await startTree(notes);
  await ensureChildren(id('s-lectures'));
  setFakeShell((name, args) => {
    const node = getNode(String(args?.id));
    return name === 'notes.setPinned' && node ? { ...node, pinned: args?.pinned } : null;
  });
});

afterEach(resetFakeShell);

describe('setPinned', () => {
  it('moves a top-level page to the top of its section', async () => {
    const before = await titles();
    const last = [...treeStore.get().children['s-lectures']]
      .map((n) => getNode(n))
      .filter((n) => n?.pageLevel === 0)
      .at(-1);
    expect(last?.title).not.toBe(before[0]);
    await setPinned(last!.id, true, notes);
    expect((await titles())[0]).toBe(last!.title);
  });

  it('leaves a subpage and a pin without the notes service where they are', async () => {
    const before = await titles();
    await setPinned(id('p-membranes'), true, notes);
    expect(await titles()).toEqual(before);
    const top = getNode(id('p-cell-structure'));
    const other = [...treeStore.get().children['s-lectures']]
      .map((n) => getNode(n))
      .find((n) => n?.pageLevel === 0 && n.id !== top?.id);
    await setPinned(other!.id, true);
    expect(await titles()).toEqual(before);
  });
});
