// @vitest-environment node
// What the tree decides before it calls the service: steps among siblings, page levels, where new items go, where
// Move to can go. All on the sample library loaded into the store.

import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryNotesService } from '../../services/notes/memory';
import type { NodeId } from '../../services/notes';
import { resetStores } from '../../state/store';
import { destinationsFor, loadDestinations, matchDestinations } from './destinations';
import { planNew } from './creation';
import { ensureChildren, startTree, stopTree } from './load';
import { levelAfter, siblingsOf, stepOf } from './moves';
import { ROOT, treeStore } from './store';

const id = (value: string) => value as NodeId;
const node = (value: string) => treeStore.get().nodes[value];
const state = () => treeStore.get();

beforeEach(async () => {
  resetStores();
  stopTree();
  await startTree(createMemoryNotesService({ seed: 'sample' }));
  for (const parent of ['n-biology', 'n-work', 'g-exam-prep', 's-lectures', 's-labs']) await ensureChildren(id(parent));
});

describe('steps among siblings', () => {
  it('moves a section before the previous one, or after the next one', () => {
    expect(stepOf(state(), id('s-labs'), 'up')).toEqual({
      placement: { parentId: 'n-biology', beforeId: 's-lectures' },
      position: 1,
      count: 3,
    });
    expect(stepOf(state(), id('s-labs'), 'down')).toEqual({
      placement: { parentId: 'n-biology', beforeId: null },
      position: 3,
      count: 3,
    });
  });

  it('stops at either end', () => {
    expect(stepOf(state(), id('s-lectures'), 'up')).toBeNull();
    expect(stepOf(state(), id('g-exam-prep'), 'down')).toBeNull();
    expect(stepOf(state(), id('n-biology'), 'up')).toBeNull();
  });

  it('moves a page with its subpages, among the pages at its level', () => {
    expect(siblingsOf(state(), id('p-mitosis'))).toEqual([
      'p-cell-structure',
      'p-mitosis',
      'p-meiosis',
      'p-photosynthesis',
    ]);
    expect(stepOf(state(), id('p-cell-structure'), 'down')?.placement).toEqual({
      parentId: 's-lectures',
      beforeId: 'p-meiosis',
    });
    expect(stepOf(state(), id('p-mitosis'), 'up')?.placement.beforeId).toBe('p-cell-structure');
  });

  it("keeps a subpage among its parent's subpages", () => {
    expect(siblingsOf(state(), id('p-membranes'))).toEqual(['p-membranes']);
    expect(stepOf(state(), id('p-membranes'), 'up')).toBeNull();
    expect(stepOf(state(), id('p-membranes'), 'down')).toBeNull();
  });
});

describe('page levels', () => {
  it('lets a page become a subpage of the one above, and a subpage be promoted', () => {
    expect(levelAfter(state(), id('p-mitosis'), 1)).toBe(1);
    expect(levelAfter(state(), id('p-membranes'), -1)).toBe(0);
  });

  it("refuses what the page can't reach", () => {
    expect(levelAfter(state(), id('p-cell-structure'), 1)).toBeNull();
    expect(levelAfter(state(), id('p-membranes'), 1)).toBeNull();
    expect(levelAfter(state(), id('p-mitosis'), -1)).toBeNull();
    expect(levelAfter(state(), id('s-labs'), 1)).toBeNull();
  });
});

describe('where new items go', () => {
  it('puts a page after the current page and its subpages, at its level', () => {
    const plan = planNew(state(), 'page', node('p-cell-structure'), node('s-lectures'));
    expect(plan).toMatchObject({
      kind: 'page',
      placement: { parentId: 's-lectures', beforeId: 'p-mitosis' },
      pageLevel: 0,
    });
  });

  it('puts a page at the end of a section when a section is current', () => {
    const plan = planNew(state(), 'page', node('s-labs'), node('s-labs'));
    expect(plan?.placement).toEqual({ parentId: 's-labs', beforeId: null });
  });

  it('puts a subpage one level down, and refuses one under a level 2 page', () => {
    expect(planNew(state(), 'subpage', node('p-cell-structure'), node('s-lectures'))).toMatchObject({
      pageLevel: 1,
      placement: { beforeId: 'p-mitosis' },
    });
    expect(planNew(state(), 'subpage', node('s-labs'), node('s-labs'))).toBeNull();
  });

  it('puts a section inside a notebook or group, and after a section', () => {
    expect(planNew(state(), 'section', node('n-work'), undefined)?.placement).toEqual({
      parentId: 'n-work',
      beforeId: null,
    });
    expect(planNew(state(), 'section', node('s-labs'), undefined)?.placement).toEqual({
      parentId: 'n-biology',
      beforeId: 'g-exam-prep',
    });
    expect(planNew(state(), 'sectionGroup', node('p-mitosis'), undefined)?.placement.parentId).toBe('n-biology');
  });

  it('puts a notebook after the notebook that holds the current item', () => {
    expect(planNew(state(), 'notebook', node('s-meetings'), undefined)?.placement).toEqual({
      parentId: null,
      beforeId: 'n-personal',
    });
    expect(planNew(state(), 'notebook', undefined, undefined)?.placement).toEqual({ parentId: null, beforeId: null });
    expect(state().children[ROOT]).toHaveLength(5);
  });
});

describe('Move to', () => {
  it('offers sections for a page, without its own', async () => {
    const places = destinationsFor(state(), node('p-mitosis'), await loadDestinations());
    expect(places.map((place) => place.title)).toContain('Labs');
    expect(places.map((place) => place.title)).not.toContain('Lectures');
    expect(places.every((place) => place.kind === 'section')).toBe(true);
  });

  it('offers notebooks and groups for a section, and nothing for a notebook', async () => {
    const all = await loadDestinations();
    const titles = destinationsFor(state(), node('s-labs'), all).map((place) => place.title);
    expect(titles).toContain('Exam prep');
    expect(titles).toContain('Work');
    expect(titles).not.toContain('Biology 101');
    expect(destinationsFor(state(), node('n-work'), all)).toEqual([]);
  });

  it('matches on the path, ignoring case and accents', async () => {
    const all = await loadDestinations();
    const found = matchDestinations(all, 'EXAM mid');
    expect(found.map((place) => place.title)).toEqual(['Midterm']);
    expect(found[0].path).toBe('Biology 101 / Exam prep / Midterm');
  });
});
