// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// Contract cases: Trash, restore, and restoring when the old parent or the next sibling is gone.

import { expect } from 'vitest';
import type { NodeId, TrashReceiptId } from '../types';
import { add, expectNotesError, kase, library, pageLevels, titles } from './helpers';
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
  kase('restore.parent-gone', 'restores a section whose group is gone to the end of its notebook', async (s) => {
    const lib = await library(s);
    const receipt = await s.trash([lib.midterm]);
    await s.trash([lib.exams]);
    const [restored] = await s.restore(receipt.id);
    expect(restored.parentId).toBe(lib.biology);
    expect(await titles(s, lib.biology)).toEqual(['Lectures', 'Labs', 'Midterm']);
    expect(await titles(s, null)).toEqual(['Biology', 'Work']);
  }),
  kase(
    'restore.page-parent-gone',
    'restores a page whose section is gone into a new section at the end of its notebook',
    async (s) => {
      const lib = await library(s);
      const receipt = await s.trash([lib.pages.Mitosis, lib.pages.Meiosis]);
      await s.trash([lib.lectures]);
      const restored = await s.restore(receipt.id);
      const section = await s.get(restored[0].parentId as NodeId);
      expect(section).toMatchObject({ kind: 'section', title: 'Lectures', parentId: lib.biology });
      expect(section?.id).not.toBe(lib.lectures);
      expect(await pageLevels(s, section?.id as NodeId)).toBe('Mitosis:0, Meiosis:0');
      expect(await titles(s, lib.biology)).toEqual(['Labs', 'Exam prep', 'Lectures']);
    },
  ),
  kase('restore.page-group-gone', 'restores a page whose section and group are gone into its notebook', async (s) => {
    const lib = await library(s);
    const receipt = await s.trash([lib.pages.Topics]);
    await s.trash([lib.exams]);
    const [restored] = await s.restore(receipt.id);
    expect(await s.get(restored.parentId as NodeId)).toMatchObject({ title: 'Midterm', parentId: lib.biology });
  }),
  kase('restore.too-deep', 'restores a group that no longer fits its old parent to its notebook', async (s) => {
    const lib = await library(s);
    const inner = await add(s, lib.exams, 'sectionGroup', 'Inner');
    const deepest = await add(s, inner.id, 'sectionGroup', 'Deepest');
    const receipt = await s.trash([deepest.id]);
    const outer = await add(s, lib.biology, 'sectionGroup', 'Outer');
    const middle = await add(s, outer.id, 'sectionGroup', 'Middle');
    await s.move([lib.exams], { parentId: middle.id, beforeId: null });
    const [restored] = await s.restore(receipt.id);
    expect(restored.parentId).toBe(lib.biology);
    expect(await titles(s, lib.biology)).toEqual(['Lectures', 'Labs', 'Outer', 'Deepest']);
  }),
  kase('trash.notebook-keeps-its-items', 'keeps the items trashed inside a notebook with it', async (s) => {
    const lib = await library(s);
    const page = await s.trash([lib.pages.Cell]);
    const notebook = await s.trash([lib.biology]);
    expect((await s.listTrash()).map((item) => item.node.id)).toEqual([lib.biology]);
    await expectNotesError(s.restore(page.id), 'not-found');
    await expectNotesError(s.restoreFromTrash([lib.pages.Cell]), 'not-found');
    await s.restore(notebook.id);
    expect((await s.listTrash()).map((item) => item.node.id)).toEqual([lib.pages.Cell]);
    await s.restore(page.id);
    expect(await pageLevels(s, lib.lectures)).toBe(LECTURES);
  }),
  kase('restore.partly-restored', 'restores what is left of a receipt after some of it was restored', async (s) => {
    const lib = await library(s);
    const receipt = await s.trash([lib.labs, lib.meetings]);
    const items = await s.listTrash();
    expect(items.map((item) => item.receiptId)).toEqual([receipt.id, receipt.id]);
    await s.restoreFromTrash([lib.labs]);
    const restored = await s.restore(receipt.id);
    expect(restored.map((node) => node.id)).toEqual([lib.meetings]);
    expect(await titles(s, lib.work)).toEqual(['Meetings']);
    await expectNotesError(s.restore(receipt.id), 'not-found');
  }),
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
