// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// Contract cases: Trash, restore, and restoring when the old parent or the next sibling is gone.

import { expect } from 'vitest';
import type { NodeId, TrashReceiptId } from '../types';
import { expectNotesError, kase, library, pageLevels, titles } from './helpers';
import type { ContractCase } from './helpers';

const LECTURES = 'Cell:0, Membranes:1, Proteins:2, Mitosis:0, Meiosis:0';

export const trashCases: readonly ContractCase[] = [
  kase('trash.page', 'trashes a page with its subpages and returns only the root', async (s) => {
    const lib = await library(s);
    const receipt = await s.trash([lib.pages.Cell]);
    expect(receipt.nodeIds).toEqual([lib.pages.Cell]);
    expect(await titles(s, lib.lectures)).toEqual(['Mitosis', 'Meiosis']);
    for (const title of ['Cell', 'Membranes', 'Proteins']) expect(await s.get(lib.pages[title])).toBeNull();
  }),
  kase('trash.section', 'trashes a section with its pages', async (s) => {
    const lib = await library(s);
    await s.trash([lib.lectures]);
    expect(await titles(s, lib.biology)).toEqual(['Labs', 'Exam prep']);
    expect((await s.get(lib.biology))?.childCount).toBe(2);
    expect(await s.get(lib.pages.Mitosis)).toBeNull();
    await expectNotesError(s.listChildren(lib.lectures), 'not-found');
  }),
  kase('trash.unknown', 'rejects trashing an unknown node with not-found', async (s) => {
    await expectNotesError(s.trash(['nope' as NodeId]), 'not-found');
  }),
  kase('trash.gone-for-moves', 'treats trashed nodes as gone for other calls', async (s) => {
    const lib = await library(s);
    await s.trash([lib.labs]);
    await expectNotesError(s.move([lib.labs], { parentId: lib.work, beforeId: null }), 'not-found');
    await expectNotesError(s.rename(lib.labs, 'Back'), 'not-found');
  }),
  kase('restore.position', 'restores nodes to their original place', async (s) => {
    const lib = await library(s);
    const receipt = await s.trash([lib.pages.Cell]);
    const restored = await s.restore(receipt.id);
    expect(restored.map((node) => node.id)).toEqual([lib.pages.Cell]);
    expect(await pageLevels(s, lib.lectures)).toBe(LECTURES);
  }),
  kase('restore.after-changes', 'restores before the old next sibling after other changes', async (s) => {
    const lib = await library(s);
    const receipt = await s.trash([lib.labs]);
    await s.move([lib.exams], { parentId: lib.biology, beforeId: lib.lectures });
    await s.restore(receipt.id);
    expect(await titles(s, lib.biology)).toEqual(['Labs', 'Exam prep', 'Lectures']);
  }),
  kase('restore.sibling-gone', 'restores at the end when the next sibling is gone', async (s) => {
    const lib = await library(s);
    const receipt = await s.trash([lib.lectures]);
    await s.trash([lib.labs]);
    await s.restore(receipt.id);
    expect(await titles(s, lib.biology)).toEqual(['Exam prep', 'Lectures']);
  }),
  kase('restore.order', 'restores several nodes in their original order', async (s) => {
    const lib = await library(s);
    const receipt = await s.trash([lib.labs, lib.lectures]);
    expect(receipt.nodeIds).toEqual([lib.lectures, lib.labs]);
    await s.restore(receipt.id);
    expect(await titles(s, lib.biology)).toEqual(['Lectures', 'Labs', 'Exam prep']);
  }),
  kase('restore.parent-gone', 'restores into a new notebook named after the old parent', async (s) => {
    const lib = await library(s);
    const receipt = await s.trash([lib.midterm]);
    await s.trash([lib.exams]);
    const [restored] = await s.restore(receipt.id);
    const notebook = await s.get(restored.parentId as NodeId);
    expect(notebook).toMatchObject({ kind: 'notebook', title: 'Exam prep' });
    expect(await titles(s, null)).toEqual(['Biology', 'Work', 'Exam prep']);
  }),
  kase(
    'restore.page-parent-gone',
    'restores a page into a new notebook and section named after its section',
    async (s) => {
      const lib = await library(s);
      const receipt = await s.trash([lib.pages.Mitosis]);
      await s.trash([lib.lectures]);
      const [restored] = await s.restore(receipt.id);
      const section = await s.get(restored.parentId as NodeId);
      expect(section).toMatchObject({ kind: 'section', title: 'Lectures' });
      expect(await s.get(section?.parentId as NodeId)).toMatchObject({ kind: 'notebook', title: 'Lectures' });
    },
  ),
  kase('restore.notebook', 'restores a notebook with everything in it', async (s) => {
    const lib = await library(s);
    const receipt = await s.trash([lib.biology]);
    expect(await titles(s, null)).toEqual(['Work']);
    await s.restore(receipt.id);
    expect(await titles(s, null)).toEqual(['Biology', 'Work']);
    expect(await pageLevels(s, lib.lectures)).toBe(LECTURES);
  }),
  kase('restore.used-receipt', 'rejects an unknown or used receipt with not-found', async (s) => {
    const lib = await library(s);
    const receipt = await s.trash([lib.labs]);
    await s.restore(receipt.id);
    await expectNotesError(s.restore(receipt.id), 'not-found');
    await expectNotesError(s.restore('nope' as TrashReceiptId), 'not-found');
  }),
  kase('trash.list', 'lists trashed roots with where they came from and their page count', async (s) => {
    const lib = await library(s);
    const receipt = await s.trash([lib.pages.Cell]);
    const items = await s.listTrash();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ receiptId: receipt.id, originalParentId: lib.lectures, pageCount: 3 });
    expect(items[0].originalParentTitle).toBe('Lectures');
    expect(items[0].node).toMatchObject({ id: lib.pages.Cell, title: 'Cell', kind: 'page' });
  }),
  kase('trash.list-section', 'counts every page inside a trashed container', async (s) => {
    const lib = await library(s);
    await s.trash([lib.exams]);
    expect((await s.listTrash())[0]).toMatchObject({ pageCount: 1, originalParentTitle: 'Biology' });
  }),
  kase('trash.restore-selected', 'restores chosen items from Trash and removes them from it', async (s) => {
    const lib = await library(s);
    await s.trash([lib.labs, lib.meetings]);
    const restored = await s.restoreFromTrash([lib.meetings]);
    expect(restored.map((node) => node.id)).toEqual([lib.meetings]);
    expect(await titles(s, lib.work)).toEqual(['Meetings']);
    expect((await s.listTrash()).map((item) => item.node.id)).toEqual([lib.labs]);
    await expectNotesError(s.restoreFromTrash([lib.meetings]), 'not-found');
  }),
];
