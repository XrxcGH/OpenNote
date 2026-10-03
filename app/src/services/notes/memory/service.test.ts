// @vitest-environment node
// The in-memory notes service runs the whole contract suite, with no todo cases, and the property test against
// the reference model. The tests below cover what only this service has: latency, failNext, and the snapshot.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotesSnapshotClient } from '../../../platform/types';
import { describeNotesService } from '../contract';
import { NotesError } from '../errors';
import { parseSnapshot } from '../snapshot';
import type { NodeId, NotesEvent } from '../types';
import { createMemoryNotesService } from '.';

describeNotesService('memory service', async () => createMemoryNotesService({ seed: 'empty' }));

function fakeSnapshot(fail = false) {
  const saves: string[] = [];
  const client: NotesSnapshotClient = {
    load: () => Promise.resolve(saves[saves.length - 1] ?? null),
    save: (json) => {
      if (fail) return Promise.reject(new Error('disk full'));
      saves.push(json);
      return Promise.resolve();
    },
  };
  return { client, saves };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the memory service', () => {
  it('serves the sample library along a saved path', async () => {
    const notes = createMemoryNotesService({ seed: 'sample' });
    const tree = await notes.loadInitial(['n-biology', 's-lectures', 'p-mitosis'] as NodeId[]);
    expect(tree.notebooks.map((node) => node.title)).toEqual(['Biology 101', 'Work', 'Personal', 'Recipes', 'Travel']);
    expect(tree.children['s-lectures']).toHaveLength(5);
    expect(tree.page?.title).toBe('Mitosis');
  });

  it('fails the next call once with the requested code', async () => {
    const notes = createMemoryNotesService({ seed: 'sample' });
    notes.failNext('unavailable');
    const error = await notes.listNotebooks().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotesError);
    expect((error as NotesError).code).toBe('unavailable');
    expect(await notes.listNotebooks()).toHaveLength(5);
  });

  it('waits the given latency before answering', async () => {
    vi.useFakeTimers();
    const notes = createMemoryNotesService({ seed: 'sample', latencyMs: 200 });
    let done = false;
    const pending = notes.listNotebooks().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(199);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toBe(true);
  });

  it('upserts the changed node and its parent, then re-lists the parent', async () => {
    const notes = createMemoryNotesService({ seed: 'sample' });
    const events: NotesEvent[] = [];
    notes.watch((event) => events.push(event));
    const page = await notes.create({
      kind: 'page',
      title: 'New',
      placement: { parentId: 's-labs' as NodeId, beforeId: null },
    });
    expect(events).toEqual([
      { type: 'upserted', nodes: [page, expect.objectContaining({ id: 's-labs', childCount: 2 })] },
      { type: 'childrenChanged', parentId: 's-labs' },
    ]);
  });
});

describe('the Phase 2 snapshot', () => {
  it('saves 1 s after the last change and reports saving until then', async () => {
    vi.useFakeTimers();
    const { client, saves } = fakeSnapshot();
    const notes = createMemoryNotesService({ seed: 'sample', snapshot: client });
    const statuses: string[] = [];
    notes.watch((event) => event.type === 'status' && statuses.push(event.status));
    await notes.rename('p-mitosis' as NodeId, 'Cell division');
    expect(notes.hasUnsavedChanges()).toBe(true);
    expect(notes.saveStatus()).toBe('saving');
    await vi.advanceTimersByTimeAsync(999);
    expect(saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves).toHaveLength(1);
    expect(notes.hasUnsavedChanges()).toBe(false);
    expect(statuses).toEqual(['saving', 'saved']);
  });

  it('saves at once on flush, and a relaunch reopens the same tree and Trash', async () => {
    const { client, saves } = fakeSnapshot();
    const notes = createMemoryNotesService({ seed: 'sample', snapshot: client });
    await notes.move(['p-meiosis' as NodeId], {
      parentId: 's-lectures' as NodeId,
      beforeId: 'p-cell-structure' as NodeId,
    });
    await notes.trash(['p-photosynthesis' as NodeId]);
    await notes.flush();
    expect(saves).toHaveLength(1);
    const again = createMemoryNotesService({ seed: parseSnapshot(saves[0]) ?? 'empty' });
    const pages = await again.listChildren('s-lectures' as NodeId);
    expect(pages.map((page) => page.title)).toEqual(['Meiosis', 'Cell structure', 'Membranes', 'Mitosis']);
    const [item] = await again.listTrash();
    expect(item).toMatchObject({ originalParentTitle: 'Lectures', node: { title: 'Photosynthesis' } });
    await again.restore(item.receiptId);
    expect((await again.listChildren('s-lectures' as NodeId)).map((page) => page.title)).toContain('Photosynthesis');
  });

  it('keeps changes unsaved and reports an error when a save fails', async () => {
    const { client } = fakeSnapshot(true);
    const notes = createMemoryNotesService({ seed: 'sample', snapshot: client });
    await notes.rename('p-mitosis' as NodeId, 'Cell division');
    const error = await notes.flush().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotesError);
    expect((error as NotesError).code).toBe('io');
    expect(notes.hasUnsavedChanges()).toBe(true);
    expect(notes.saveStatus()).toBe('error');
  });

  it('reads seed fixture JSON without Trash, and drops Trash items it cannot read', () => {
    const json = JSON.stringify({ folder: 'C:\\Notes', notebooks: [], trash: [{ receiptId: 1 }] });
    expect(parseSnapshot(json)).toEqual({ folder: 'C:\\Notes', notebooks: [], trash: [] });
    expect(parseSnapshot('{"folder": 3}')).toBeNull();
  });
});
