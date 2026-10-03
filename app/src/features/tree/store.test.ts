// @vitest-environment node
// The tree store with the in-memory service. It covers loading along the location, and merging events without new
// objects. It covers optimistic changes with rollback, temporary ids, the undo stack, rows, and the debounce.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocation, navigate } from '../../app/location';
import { createMemoryNotesService } from '../../services/notes/memory';
import type { MemoryNotesService } from '../../services/notes/memory';
import type { NodeId } from '../../services/notes';
import { sessionStore } from '../../state/session';
import { resetStores } from '../../state/store';
import { colorNode, moveNodes, renameNode, trashNodes } from './actions';
import { createItem } from './create';
import { applyEvent, ensureChildren, startTree, stopTree } from './load';
import { commitRename, setDraft } from './rename';
import { notebookRows, pageRows } from './rows';
import { select, selectedIn } from './selection';
import { ROOT, treeStore } from './store';
import { canUndo, redo, undo, undoStore } from './undo';

const id = (value: string) => value as NodeId;
const titlesIn = (parent: string) =>
  (treeStore.get().children[parent] ?? []).map((child) => treeStore.get().nodes[child]?.title);

let notes: MemoryNotesService;

async function start(fixture: 'sample' | 'deep' = 'sample', latencyMs = 0) {
  notes = createMemoryNotesService({ seed: fixture, latencyMs });
  await startTree(notes);
}

beforeEach(() => {
  resetStores();
  stopTree();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loading', () => {
  it('loads the notebooks and opens the first one when nothing was open', async () => {
    await start();
    expect(titlesIn(ROOT)).toEqual(['Biology 101', 'Work', 'Personal', 'Recipes', 'Travel']);
    expect(sessionStore.get().expanded).toEqual(['n-biology']);
    expect(titlesIn('n-biology')).toEqual(['Lectures', 'Labs', 'Exam prep']);
  });

  it('loads along the saved location, through section groups', async () => {
    navigate({ view: 'workspace', notebookId: id('d-n-1'), sectionId: id('d-s-leaf'), pageId: id('d-p-2') });
    await start('deep');
    expect(sessionStore.get().expanded).toEqual(['d-n-1', 'd-g-1', 'd-g-2', 'd-g-3', 'd-g-4']);
    expect(titlesIn('d-s-leaf')).toEqual(['Top page', 'Subpage', 'Sub-subpage', 'Second top page']);
  });

  it('merges an echoed event without making new objects', async () => {
    await start();
    const before = treeStore.get();
    applyEvent({ type: 'upserted', nodes: [before.nodes['n-work']] });
    expect(treeStore.get()).toBe(before);
    applyEvent({ type: 'removed', ids: [id('no-such-node')] });
    expect(treeStore.get()).toBe(before);
  });
});

describe('optimistic changes', () => {
  it('renames at once and keeps the name the service returns', async () => {
    await start();
    const done = renameNode(notes, id('s-labs'), '  Practicals ');
    expect(treeStore.get().nodes['s-labs'].title).toBe('Practicals');
    await done;
    expect((await notes.get(id('s-labs')))?.title).toBe('Practicals');
  });

  it('puts the old name back when the service refuses', async () => {
    await start();
    notes.failNext('io');
    await expect(renameNode(notes, id('s-labs'), 'Practicals')).rejects.toThrow();
    expect(treeStore.get().nodes['s-labs'].title).toBe('Labs');
    expect(canUndo()).toBe(false);
  });

  it('moves at once, and moves back when the service refuses', async () => {
    await start();
    notes.failNext('unavailable');
    const failed = moveNodes(notes, [id('s-labs')], { parentId: id('n-biology'), beforeId: id('s-lectures') });
    expect(titlesIn('n-biology')).toEqual(['Labs', 'Lectures', 'Exam prep']);
    await expect(failed).rejects.toThrow();
    expect(titlesIn('n-biology')).toEqual(['Lectures', 'Labs', 'Exam prep']);
  });

  it('gives a new item a temporary id, and commits a rename made before the service answers', async () => {
    await start('sample', 100);
    const created = createItem(notes, { kind: 'section', placement: { parentId: id('n-work'), beforeId: null } });
    await vi.waitUntil(() => treeStore.get().renaming !== null, { interval: 5, timeout: 1000 });
    const renaming = treeStore.get().renaming;
    expect(renaming).toMatchObject({ draft: 'Untitled section', isNew: true });
    expect(renaming?.id.startsWith('tmp-')).toBe(true);
    setDraft('Planning');
    const committed = commitRename(notes);
    const node = await created;
    expect(await committed).toBe(true);
    expect(treeStore.get().renaming).toBeNull();
    expect(titlesIn('n-work')).toEqual(['Meetings', 'Projects', 'Planning']);
    expect((await notes.get(node?.id as NodeId))?.title).toBe('Planning');
  });

  it('keeps a rename field open with the message when the name is empty', async () => {
    await start();
    treeStore.set((state) => ({ ...state, renaming: { id: id('s-labs'), draft: '  ', error: null, isNew: false } }));
    expect(await commitRename(notes)).toBe(false);
    expect(treeStore.get().renaming?.error).toBe("A name can't be empty.");
  });
});

describe('the undo stack', () => {
  it('undoes and redoes a trash, a move, a color, and a rename', async () => {
    await start();
    await ensureChildren(id('n-work'));
    await renameNode(notes, id('s-labs'), 'Practicals');
    await colorNode(notes, id('s-labs'), 'fern');
    await moveNodes(notes, [id('s-labs')], { parentId: id('n-work'), beforeId: null });
    await trashNodes(notes, [id('s-labs')]);
    expect(titlesIn('n-work')).toEqual(['Meetings', 'Projects']);
    for (let i = 0; i < 4; i += 1) await undo(notes);
    expect(titlesIn('n-biology')).toEqual(['Lectures', 'Labs', 'Exam prep']);
    expect(treeStore.get().nodes['s-labs']).toMatchObject({ title: 'Labs', color: 'amber' });
    await redo(notes);
    await redo(notes);
    expect(treeStore.get().nodes['s-labs']).toMatchObject({ title: 'Practicals', color: 'fern' });
  });

  it('puts a moved page back at its old level', async () => {
    await start();
    await ensureChildren(id('s-lectures'));
    await moveNodes(notes, [id('p-membranes')], { parentId: id('s-lectures'), beforeId: id('p-cell-structure') });
    expect((await notes.get(id('p-membranes')))?.pageLevel).toBe(0);
    await undo(notes);
    const pages = await notes.listChildren(id('s-lectures'));
    expect(pages.map((page) => `${page.title}:${page.pageLevel}`).slice(0, 2)).toEqual([
      'Cell structure:0',
      'Membranes:1',
    ]);
  });

  it('keeps the last 20 changes', async () => {
    await start();
    for (let i = 0; i < 25; i += 1) await renameNode(notes, id('s-labs'), `Labs ${i}`);
    expect(undoStore.get().past).toHaveLength(20);
  });
});

describe('rows', () => {
  it('gives the notebooks tree levels, positions, and set sizes', async () => {
    await start();
    const rows = notebookRows(treeStore.get(), new Set(['n-biology']));
    const exam = rows.find((row) => row.id === 'g-exam-prep');
    expect(exam).toMatchObject({ level: 2, posinset: 3, setsize: 3, expanded: false });
    expect(rows.find((row) => row.id === 'n-work')).toMatchObject({ level: 1, posinset: 2, setsize: 5 });
  });

  it('nests subpages under their page and folds them away', async () => {
    await start();
    await ensureChildren(id('s-lectures'));
    const rows = pageRows(treeStore.get(), id('s-lectures'));
    expect(rows.map((row) => [row.node.title, row.level, row.posinset, row.setsize])).toEqual([
      ['Cell structure', 1, 1, 4],
      ['Membranes', 2, 1, 1],
      ['Mitosis', 1, 2, 4],
      ['Meiosis', 1, 3, 4],
      ['Photosynthesis', 1, 4, 4],
    ]);
    treeStore.set((state) => ({ ...state, folded: { 'p-cell-structure': true } }));
    expect(pageRows(treeStore.get(), id('s-lectures')).map((row) => row.node.title)).not.toContain('Membranes');
  });
});

describe('selection', () => {
  it('shows the row as selected at once and opens it after the arrow keys pause', async () => {
    await start();
    vi.useFakeTimers();
    select(id('s-labs'), 'follow');
    expect(selectedIn('notebooks')).toBe('s-labs');
    expect(getLocation()).toMatchObject({ sectionId: null });
    await vi.advanceTimersByTimeAsync(100);
    expect(getLocation()).toMatchObject({ view: 'workspace', notebookId: 'n-biology', sectionId: 's-labs' });
    expect(sessionStore.get().back).toHaveLength(0);
  });

  it('opens a clicked section at once, with its first page, and adds a history entry', async () => {
    await start();
    select(id('s-lectures'), 'now');
    await vi.waitUntil(() => (getLocation() as { pageId: string | null }).pageId !== null);
    expect(getLocation()).toMatchObject({ sectionId: 's-lectures', pageId: 'p-cell-structure' });
    expect(sessionStore.get().back).toHaveLength(1);
  });
});
