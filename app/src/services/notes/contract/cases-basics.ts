// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// Contract cases: an empty library, creating, renaming, and colors.

import { expect } from 'vitest';
import { NotesError } from '../errors';
import type { NodeId } from '../types';
import { add, expectNotesError, ISO_DATE, kase, library, pageLevels, titles } from './helpers';
import type { ContractCase } from './helpers';

const unknown = 'no-such-node' as NodeId;

export const basicCases: readonly ContractCase[] = [
  kase('basics.version', 'reports contract version 1', async (s) => {
    expect(s.contractVersion).toBe(1);
  }),
  kase('basics.empty', 'starts with no notebooks', async (s) => {
    expect(await s.listNotebooks()).toEqual([]);
  }),
  kase('basics.get-unknown', 'returns null for an unknown id', async (s) => {
    expect(await s.get(unknown)).toBeNull();
  }),
  kase('basics.children-unknown', 'rejects listing the children of an unknown node with not-found', async (s) => {
    await expectNotesError(s.listChildren(unknown), 'not-found');
  }),
  kase('basics.saved', 'starts saved, with nothing unsaved', async (s) => {
    expect(s.saveStatus()).toBe('saved');
    expect(s.hasUnsavedChanges()).toBe(false);
  }),
  kase('basics.flush-empty', 'flushes with nothing to save', async (s) => {
    await s.flush();
    expect(s.hasUnsavedChanges()).toBe(false);
  }),
  kase('basics.watch', 'returns an unsubscribe function from watch', async (s) => {
    const unsubscribe = s.watch(() => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  }),
  kase('basics.errors-are-notes-errors', 'rejects only with NotesError', async (s) => {
    const error = await s.create({ kind: 'section', placement: { parentId: unknown, beforeId: null } }).catch((e) => e);
    expect(error).toBeInstanceOf(NotesError);
  }),
];

export const createCases: readonly ContractCase[] = [
  kase('create.notebook-end', 'adds a notebook at the end', async (s) => {
    await add(s, null, 'notebook', 'One');
    await add(s, null, 'notebook', 'Two');
    expect(await titles(s, null)).toEqual(['One', 'Two']);
  }),
  kase('create.before', 'adds a notebook before another one', async (s) => {
    const two = await add(s, null, 'notebook', 'Two');
    await s.create({ kind: 'notebook', title: 'One', placement: { parentId: null, beforeId: two.id } });
    expect(await titles(s, null)).toEqual(['One', 'Two']);
  }),
  kase('create.containers', 'adds sections and section groups to a notebook in order', async (s) => {
    const lib = await library(s);
    expect(await titles(s, lib.biology)).toEqual(['Lectures', 'Labs', 'Exam prep']);
    expect(await titles(s, lib.exams)).toEqual(['Midterm']);
  }),
  kase('create.pages', 'adds pages and subpages to a section', async (s) => {
    const lib = await library(s);
    expect(await pageLevels(s, lib.lectures)).toBe('Cell:0, Membranes:1, Proteins:2, Mitosis:0, Meiosis:0');
  }),
  kase('create.summary', 'describes a new node', async (s) => {
    const notebook = await add(s, null, 'notebook', 'Biology', { color: 'fern' });
    const section = await add(s, notebook.id, 'section', 'Lectures');
    expect(section).toMatchObject({ kind: 'section', parentId: notebook.id, title: 'Lectures', color: null });
    expect(section).toMatchObject({ pageLevel: 0, childCount: 0, readOnly: false });
    expect(notebook.parentId).toBeNull();
    expect(notebook.color).toBe('fern');
    expect(section.created).toMatch(ISO_DATE);
    expect(section.modified).toMatch(ISO_DATE);
    expect(await s.get(section.id)).toEqual(section);
  }),
  kase('create.child-count', "counts a container's direct children", async (s) => {
    const lib = await library(s);
    expect((await s.get(lib.biology))?.childCount).toBe(3);
    expect((await s.get(lib.lectures))?.childCount).toBe(5);
    expect((await s.get(lib.pages.Cell))?.childCount).toBe(0);
  }),
  kase('create.trim', 'trims titles', async (s) => {
    expect((await add(s, null, 'notebook', '  Biology  ')).title).toBe('Biology');
  }),
  kase('create.default-title', 'gives a node a title when none is passed', async (s) => {
    const node = await s.create({ kind: 'notebook', placement: { parentId: null, beforeId: null } });
    expect(node.title.trim().length).toBeGreaterThan(0);
  }),
  kase('create.empty-title', 'rejects an empty title with invalid-name', async (s) => {
    await expectNotesError(add(s, null, 'notebook', '   '), 'invalid-name', 'empty');
  }),
  kase('create.long-title', 'accepts 200 characters and rejects 201 with invalid-name', async (s) => {
    expect((await add(s, null, 'notebook', 'a'.repeat(200))).title).toHaveLength(200);
    await expectNotesError(add(s, null, 'notebook', 'a'.repeat(201)), 'invalid-name', 'too-long');
  }),
  kase('create.kind-top', 'rejects a section outside a notebook with invalid-move', async (s) => {
    await expectNotesError(add(s, null, 'section', 'Loose'), 'invalid-move');
  }),
  kase('create.kind-page', 'rejects a page directly in a notebook with invalid-move', async (s) => {
    const notebook = await add(s, null, 'notebook', 'Biology');
    await expectNotesError(add(s, notebook.id, 'page', 'Loose'), 'invalid-move');
    await expectNotesError(add(s, notebook.id, 'notebook', 'Nested'), 'invalid-move');
  }),
  kase('create.unknown-parent', 'rejects an unknown parent with not-found', async (s) => {
    await expectNotesError(add(s, unknown, 'section', 'Lost'), 'not-found');
  }),
  kase('create.before-elsewhere', "rejects a beforeId that isn't a child of the parent", async (s) => {
    const lib = await library(s);
    const placement = { parentId: lib.biology, beforeId: lib.meetings };
    await expectNotesError(s.create({ kind: 'section', title: 'X', placement }), 'invalid-move');
  }),
  kase('create.page-color', 'keeps colors for containers and never for pages', async (s) => {
    const lib = await library(s);
    const page = await add(s, lib.labs, 'page', 'Colored', { color: 'brick' });
    expect(page.color).toBeNull();
    expect((await add(s, lib.biology, 'section', 'Tinted', { color: 'walnut' })).color).toBe('walnut');
  }),
  kase('create.first-subpage', 'rejects a subpage as the first page of a section', async (s) => {
    const lib = await library(s);
    await expectNotesError(add(s, lib.meetings, 'page', 'Orphan', { pageLevel: 1 }), 'invalid-move');
  }),
  kase('create.too-deep', 'rejects a page more than one level deeper than the page before it', async (s) => {
    const lib = await library(s);
    await expectNotesError(add(s, lib.labs, 'page', 'Deep', { pageLevel: 2 }), 'invalid-move');
  }),
  kase('create.orphans-next', 'rejects a page that would leave the next page too deep', async (s) => {
    const lib = await library(s);
    const placement = { parentId: lib.lectures, beforeId: lib.pages.Proteins };
    await expectNotesError(s.create({ kind: 'page', title: 'X', pageLevel: 0, placement }), 'invalid-move');
    expect(await titles(s, lib.lectures)).toEqual(['Cell', 'Membranes', 'Proteins', 'Mitosis', 'Meiosis']);
  }),
];

export const renameCases: readonly ContractCase[] = [
  kase('rename.title', 'renames and trims', async (s) => {
    const lib = await library(s);
    const renamed = await s.rename(lib.lectures, '  Talks ');
    expect(renamed.title).toBe('Talks');
    expect((await s.get(lib.lectures))?.title).toBe('Talks');
    expect(renamed.modified >= renamed.created).toBe(true);
  }),
  kase('rename.empty', 'rejects an empty title and keeps the old one', async (s) => {
    const lib = await library(s);
    await expectNotesError(s.rename(lib.lectures, ''), 'invalid-name', 'empty');
    expect((await s.get(lib.lectures))?.title).toBe('Lectures');
  }),
  kase('rename.unknown', 'rejects renaming an unknown node with not-found', async (s) => {
    await expectNotesError(s.rename(unknown, 'Title'), 'not-found');
  }),
  kase('color.set-clear', 'sets and clears a color', async (s) => {
    const lib = await library(s);
    expect((await s.setColor(lib.lectures, 'indigo')).color).toBe('indigo');
    expect((await s.get(lib.lectures))?.color).toBe('indigo');
    expect((await s.setColor(lib.lectures, null)).color).toBeNull();
  }),
  kase('color.page', 'keeps pages without a color', async (s) => {
    const lib = await library(s);
    expect((await s.setColor(lib.pages.Cell, 'fern')).color).toBeNull();
  }),
];
