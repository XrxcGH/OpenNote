// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// Contract cases: loading along a saved path, events, and flushing.

import { expect } from 'vitest';
import type { NodeId, NodeSummary, NotesEvent } from '../types';
import { add, kase, library } from './helpers';
import type { ContractCase } from './helpers';

const STABLE = ['id', 'kind', 'parentId', 'title', 'color', 'pageLevel'] as const;
const stable = (node: NodeSummary) => Object.fromEntries(STABLE.map((key) => [key, node[key]]));

export const loadCases: readonly ContractCase[] = [
  kase('load.empty', 'loads an empty library', async (s) => {
    const tree = await s.loadInitial([]);
    expect(tree).toMatchObject({ notebooks: [], children: {}, resolvedPath: [], page: null });
    expect(typeof tree.library.folder).toBe('string');
    expect(typeof tree.library.readOnly).toBe('boolean');
  }),
  kase('load.path', 'loads the notebooks, the children along the path, and the page', async (s) => {
    const lib = await library(s);
    const path = [lib.biology, lib.exams, lib.midterm, lib.pages.Topics];
    const tree = await s.loadInitial(path);
    expect(tree.notebooks.map((node) => node.title)).toEqual(['Biology', 'Work']);
    expect(tree.resolvedPath).toEqual(path);
    expect(Object.keys(tree.children)).toEqual(expect.arrayContaining([lib.biology, lib.exams, lib.midterm]));
    expect(tree.children[lib.exams].map((node) => node.title)).toEqual(['Midterm']);
    expect(tree.page?.id).toBe(lib.pages.Topics);
  }),
  kase('load.prefix', 'stops at the longest part of the path that still exists', async (s) => {
    const lib = await library(s);
    await s.trash([lib.pages.Mitosis]);
    const tree = await s.loadInitial([lib.biology, lib.lectures, lib.pages.Mitosis]);
    expect(tree.resolvedPath).toEqual([lib.biology, lib.lectures]);
    expect(tree.page).toBeNull();
    expect(tree.children[lib.lectures].map((node) => node.title)).toEqual(['Cell', 'Membranes', 'Proteins', 'Meiosis']);
  }),
  kase('load.bad-path', "ignores a path that doesn't start with a notebook", async (s) => {
    const lib = await library(s);
    const tree = await s.loadInitial([lib.lectures, lib.pages.Cell]);
    expect(tree.resolvedPath).toEqual([]);
    expect(tree.page).toBeNull();
    expect(tree.notebooks).toHaveLength(2);
  }),
  kase('load.broken-chain', 'stops where a node is not a child of the one before it', async (s) => {
    const lib = await library(s);
    const tree = await s.loadInitial([lib.work, lib.lectures]);
    expect(tree.resolvedPath).toEqual([lib.work]);
  }),
];

export const eventCases: readonly ContractCase[] = [
  kase('events.consistent', 'sends events that match what get returns', async (s) => {
    const events: NotesEvent[] = [];
    const unsubscribe = s.watch((event) => events.push(event));
    const lib = await library(s);
    await s.rename(lib.labs, 'Practicals');
    await s.setColor(lib.labs, 'amber');
    await s.trash([lib.meetings]);
    unsubscribe();
    const latest = new Map<string, NodeSummary>();
    const removed = new Set<string>();
    for (const event of events) {
      if (event.type === 'upserted') event.nodes.forEach((node) => latest.set(node.id, node));
      if (event.type === 'removed') event.ids.forEach((id) => removed.add(id));
    }
    for (const id of removed) expect(await s.get(id as NodeId)).toBeNull();
    for (const [id, node] of latest) {
      if (removed.has(id)) continue;
      const current = await s.get(id as NodeId);
      expect(current && stable(current)).toEqual(stable(node));
    }
  }),
  kase('events.unsubscribe', 'stops sending events after unsubscribing', async (s) => {
    let count = 0;
    const unsubscribe = s.watch(() => (count += 1));
    unsubscribe();
    await add(s, null, 'notebook', 'Quiet');
    expect(count).toBe(0);
  }),
  kase('flush.after-changes', 'flushes changes so nothing is left unsaved', async (s) => {
    const lib = await library(s);
    await s.rename(lib.lectures, 'Talks');
    await s.flush();
    expect(s.hasUnsavedChanges()).toBe(false);
    expect(s.saveStatus()).toBe('saved');
  }),
  kase('flush.reads-are-clean', "doesn't count reads as unsaved changes", async (s) => {
    await s.flush();
    await s.listNotebooks();
    await s.loadInitial([]);
    expect(s.hasUnsavedChanges()).toBe(false);
  }),
];
