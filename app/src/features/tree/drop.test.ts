// @vitest-environment node
// Drag target math: which row a pointer is over, and where a drop would land, for every kind.

import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryNotesService } from '../../services/notes/memory';
import type { NodeId } from '../../services/notes';
import { sessionStore } from '../../state/session';
import { resetStores } from '../../state/store';
import { resolveDrop, rowAt } from './drop';
import { ensureChildren, startTree, stopTree } from './load';
import { notebookRows, pageRows } from './rows';
import { treeStore } from './store';

const id = (value: string) => value as NodeId;
const node = (value: string) => treeStore.get().nodes[value];

beforeEach(async () => {
  resetStores();
  stopTree();
  await startTree(createMemoryNotesService({ seed: 'sample' }));
  for (const parent of ['n-biology', 'n-work', 'g-exam-prep', 's-lectures']) await ensureChildren(id(parent));
  sessionStore.set((state) => ({ ...state, expanded: ['n-biology', 'n-work', 'g-exam-prep'] }));
});

const notebooks = () => notebookRows(treeStore.get(), new Set(sessionStore.get().expanded));
const pages = () => pageRows(treeStore.get(), id('s-lectures'));
const row = (rows: ReturnType<typeof notebooks>, name: string) => rows.find((candidate) => candidate.id === name)!;

describe('rowAt', () => {
  const geometry = { top: 100, rowHeight: 32, count: 10 };

  it('finds the row and the place in it', () => {
    expect(rowAt(100, geometry)).toEqual({ index: 0, fraction: 0 });
    expect(rowAt(100 + 32 * 3 + 8, geometry)).toEqual({ index: 3, fraction: 0.25 });
  });

  it('clamps above the first row and below the last', () => {
    expect(rowAt(50, geometry)).toEqual({ index: 0, fraction: 0 });
    expect(rowAt(9999, geometry)).toEqual({ index: 9, fraction: 1 });
  });

  it('finds nothing in an empty list', () => {
    expect(rowAt(120, { top: 100, rowHeight: 32, count: 0 })).toBeNull();
  });
});

describe('dropping a section', () => {
  it('goes into a notebook or group at its middle, and beside a section at its edges', () => {
    const labs = node('s-labs');
    expect(resolveDrop(treeStore.get(), labs, row(notebooks(), 'n-work'), 0.5)).toMatchObject({
      zone: 'into',
      placement: { parentId: 'n-work', beforeId: null },
    });
    expect(resolveDrop(treeStore.get(), labs, row(notebooks(), 'g-exam-prep'), 0.5)?.placement.parentId).toBe(
      'g-exam-prep',
    );
    expect(resolveDrop(treeStore.get(), labs, row(notebooks(), 's-meetings'), 0.1)).toMatchObject({
      zone: 'before',
      placement: { parentId: 'n-work', beforeId: 's-meetings' },
    });
    expect(resolveDrop(treeStore.get(), labs, row(notebooks(), 's-meetings'), 0.9)).toMatchObject({
      zone: 'after',
      placement: { parentId: 'n-work', beforeId: 's-projects' },
    });
  });

  it('splits the middle of a section row into before and after', () => {
    const labs = node('s-labs');
    expect(resolveDrop(treeStore.get(), labs, row(notebooks(), 's-projects'), 0.4)?.zone).toBe('before');
    expect(resolveDrop(treeStore.get(), labs, row(notebooks(), 's-projects'), 0.6)?.zone).toBe('after');
  });

  it("refuses a top level place and the row's own place", () => {
    const labs = node('s-labs');
    expect(resolveDrop(treeStore.get(), labs, row(notebooks(), 'n-work'), 0.05)).toBeNull();
    expect(resolveDrop(treeStore.get(), labs, row(notebooks(), 's-lectures'), 0.9)).toBeNull();
    expect(resolveDrop(treeStore.get(), labs, row(notebooks(), 's-labs'), 0.5)).toBeNull();
  });
});

describe('dropping a page', () => {
  it('goes beside a page, after its subpages, and into a section of the notebooks tree', () => {
    const mitosis = node('p-mitosis');
    expect(resolveDrop(treeStore.get(), mitosis, row(pages(), 'p-photosynthesis'), 0.9)).toMatchObject({
      zone: 'after',
      placement: { parentId: 's-lectures', beforeId: null },
    });
    expect(resolveDrop(treeStore.get(), mitosis, row(pages(), 'p-cell-structure'), 0.1)?.placement.beforeId).toBe(
      'p-cell-structure',
    );
    expect(resolveDrop(treeStore.get(), mitosis, row(notebooks(), 's-labs'), 0.5)).toMatchObject({
      zone: 'into',
      target: { title: 'Labs' },
      placement: { parentId: 's-labs', beforeId: null },
    });
  });

  it('refuses notebooks and groups, and its own block', () => {
    const cell = node('p-cell-structure');
    expect(resolveDrop(treeStore.get(), cell, row(notebooks(), 'n-work'), 0.5)).toBeNull();
    expect(resolveDrop(treeStore.get(), cell, row(notebooks(), 'g-exam-prep'), 0.5)).toBeNull();
    expect(resolveDrop(treeStore.get(), cell, row(pages(), 'p-membranes'), 0.5)).toBeNull();
  });
});

describe('dropping a notebook or a group', () => {
  it('reorders notebooks beside notebooks only', () => {
    const work = node('n-work');
    expect(resolveDrop(treeStore.get(), work, row(notebooks(), 'n-biology'), 0.1)).toMatchObject({
      placement: { parentId: null, beforeId: 'n-biology' },
    });
    expect(resolveDrop(treeStore.get(), work, row(notebooks(), 's-labs'), 0.5)).toBeNull();
  });

  it('keeps a group out of itself', () => {
    const group = node('g-exam-prep');
    expect(resolveDrop(treeStore.get(), group, row(notebooks(), 's-midterm'), 0.1)).toBeNull();
    expect(resolveDrop(treeStore.get(), group, row(notebooks(), 'n-work'), 0.5)?.placement.parentId).toBe('n-work');
  });
});
