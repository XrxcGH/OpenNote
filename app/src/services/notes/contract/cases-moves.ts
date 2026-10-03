// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// Contract cases: order, moves across parents, beforeId edge cases, kind rules, and page levels.

import { expect } from 'vitest';
import type { NodeId } from '../types';
import { add, expectNotesError, kase, library, pageLevels, titles } from './helpers';
import type { ContractCase } from './helpers';

const LECTURES = 'Cell:0, Membranes:1, Proteins:2, Mitosis:0, Meiosis:0';

export const moveCases: readonly ContractCase[] = [
  kase('move.before-sibling', 'moves a node before a sibling', async (s) => {
    const lib = await library(s);
    await s.move([lib.exams], { parentId: lib.biology, beforeId: lib.lectures });
    expect(await titles(s, lib.biology)).toEqual(['Exam prep', 'Lectures', 'Labs']);
  }),
  kase('move.end', 'moves a node to the end with beforeId null', async (s) => {
    const lib = await library(s);
    await s.move([lib.lectures], { parentId: lib.biology, beforeId: null });
    expect(await titles(s, lib.biology)).toEqual(['Labs', 'Exam prep', 'Lectures']);
  }),
  kase('move.same-place', 'treats moving to the same place as a no-op', async (s) => {
    const lib = await library(s);
    await s.move([lib.lectures], { parentId: lib.biology, beforeId: lib.labs });
    await s.move([lib.labs], { parentId: lib.biology, beforeId: lib.labs });
    expect(await titles(s, lib.biology)).toEqual(['Lectures', 'Labs', 'Exam prep']);
  }),
  kase('move.several', 'moves several nodes in the given order', async (s) => {
    const lib = await library(s);
    await s.move([lib.exams, lib.lectures], { parentId: lib.biology, beforeId: null });
    expect(await titles(s, lib.biology)).toEqual(['Labs', 'Exam prep', 'Lectures']);
  }),
  kase('move.before-moved', 'places nodes after the removed ones when beforeId is being moved', async (s) => {
    const lib = await library(s);
    await s.move([lib.lectures, lib.labs], { parentId: lib.biology, beforeId: lib.labs });
    expect(await titles(s, lib.biology)).toEqual(['Lectures', 'Labs', 'Exam prep']);
  }),
  kase('move.across', 'moves a section to another notebook and updates both counts', async (s) => {
    const lib = await library(s);
    await s.move([lib.labs], { parentId: lib.work, beforeId: lib.meetings });
    expect(await titles(s, lib.work)).toEqual(['Labs', 'Meetings']);
    expect((await s.get(lib.labs))?.parentId).toBe(lib.work);
    expect((await s.get(lib.biology))?.childCount).toBe(2);
    expect((await s.get(lib.work))?.childCount).toBe(2);
  }),
  kase('move.into-group', 'moves a section into a section group', async (s) => {
    const lib = await library(s);
    await s.move([lib.labs], { parentId: lib.exams, beforeId: null });
    expect(await titles(s, lib.exams)).toEqual(['Midterm', 'Labs']);
  }),
  kase('move.group-contents', 'moves a section group with everything in it', async (s) => {
    const lib = await library(s);
    await s.move([lib.exams], { parentId: lib.work, beforeId: null });
    expect(await titles(s, lib.exams)).toEqual(['Midterm']);
    expect(await titles(s, lib.midterm)).toEqual(['Topics']);
  }),
  kase('move.cycle', 'rejects moving a group into its own section group and changes nothing', async (s) => {
    const lib = await library(s);
    const inner = await add(s, lib.exams, 'sectionGroup', 'Inner');
    await expectNotesError(s.move([lib.exams], { parentId: inner.id, beforeId: null }), 'invalid-move');
    await expectNotesError(s.move([lib.exams], { parentId: lib.exams, beforeId: null }), 'invalid-move');
    expect(await titles(s, lib.biology)).toEqual(['Lectures', 'Labs', 'Exam prep']);
  }),
  kase('move.group-depth', 'rejects a move that nests section groups more than 4 deep', async (s) => {
    const lib = await library(s);
    const inner = await add(s, lib.exams, 'sectionGroup', 'Inner');
    const two = await add(s, lib.biology, 'sectionGroup', 'Two');
    const three = await add(s, two.id, 'sectionGroup', 'Three');
    const four = await add(s, three.id, 'sectionGroup', 'Four');
    await expectNotesError(s.move([lib.exams], { parentId: four.id, beforeId: null }), 'invalid-move');
    expect(await titles(s, lib.biology)).toEqual(['Lectures', 'Labs', 'Exam prep', 'Two']);
    await s.move([lib.exams], { parentId: three.id, beforeId: null });
    expect(await titles(s, three.id)).toEqual(['Four', 'Exam prep']);
    await s.move([inner.id], { parentId: four.id, beforeId: null });
    expect(await titles(s, four.id)).toEqual(['Inner']);
  }),
  kase('move.kind', 'rejects moves that break the kind rules and changes nothing', async (s) => {
    const lib = await library(s);
    await expectNotesError(s.move([lib.pages.Mitosis], { parentId: lib.biology, beforeId: null }), 'invalid-move');
    await expectNotesError(s.move([lib.work], { parentId: lib.biology, beforeId: null }), 'invalid-move');
    await expectNotesError(s.move([lib.labs], { parentId: null, beforeId: null }), 'invalid-move');
    await expectNotesError(s.move([lib.labs], { parentId: lib.lectures, beforeId: null }), 'invalid-move');
    expect(await titles(s, lib.biology)).toEqual(['Lectures', 'Labs', 'Exam prep']);
    expect(await pageLevels(s, lib.lectures)).toBe(LECTURES);
  }),
  kase('move.unknown', 'rejects moving an unknown node with not-found', async (s) => {
    const lib = await library(s);
    await expectNotesError(s.move(['nope' as NodeId], { parentId: lib.biology, beforeId: null }), 'not-found');
  }),
  kase('move.before-elsewhere', 'rejects a beforeId from another parent', async (s) => {
    const lib = await library(s);
    await expectNotesError(s.move([lib.labs], { parentId: lib.biology, beforeId: lib.meetings }), 'invalid-move');
  }),
  kase('move.notebooks', 'reorders notebooks', async (s) => {
    const lib = await library(s);
    await s.move([lib.work], { parentId: null, beforeId: lib.biology });
    expect(await titles(s, null)).toEqual(['Work', 'Biology']);
  }),
];

export const pageMoveCases: readonly ContractCase[] = [
  kase('pages.with-subpages', 'moves a page with its subpages', async (s) => {
    const lib = await library(s);
    await s.move([lib.pages.Cell], { parentId: lib.lectures, beforeId: null });
    expect(await pageLevels(s, lib.lectures)).toBe('Mitosis:0, Meiosis:0, Cell:0, Membranes:1, Proteins:2');
  }),
  kase('pages.subpage-to-top', 'makes a subpage moved to the top a page, keeping its own subpages', async (s) => {
    const lib = await library(s);
    await s.move([lib.pages.Membranes], { parentId: lib.lectures, beforeId: lib.pages.Cell });
    expect(await pageLevels(s, lib.lectures)).toBe('Membranes:0, Proteins:1, Cell:0, Mitosis:0, Meiosis:0');
  }),
  kase('pages.subpage-keeps-level', 'keeps a subpage level where it still fits', async (s) => {
    const lib = await library(s);
    await s.move([lib.pages.Membranes], { parentId: lib.lectures, beforeId: lib.pages.Meiosis });
    expect(await pageLevels(s, lib.lectures)).toBe('Cell:0, Mitosis:0, Membranes:1, Proteins:2, Meiosis:0');
  }),
  kase('pages.across', 'moves pages to another section with their subpages', async (s) => {
    const lib = await library(s);
    await s.move([lib.pages.Cell], { parentId: lib.labs, beforeId: null });
    expect(await pageLevels(s, lib.labs)).toBe('Lab 1:0, Cell:0, Membranes:1, Proteins:2');
    expect(await pageLevels(s, lib.lectures)).toBe('Mitosis:0, Meiosis:0');
    expect((await s.get(lib.pages.Proteins))?.parentId).toBe(lib.labs);
  }),
  kase('pages.orphans-next', 'rejects a move that would leave the next page too deep', async (s) => {
    const lib = await library(s);
    const placement = { parentId: lib.lectures, beforeId: lib.pages.Proteins };
    await expectNotesError(s.move([lib.pages.Mitosis], placement), 'invalid-move');
    expect(await pageLevels(s, lib.lectures)).toBe(LECTURES);
  }),
  kase('pages.subpage-and-parent', 'moves a page once when its subpage is also named', async (s) => {
    const lib = await library(s);
    await s.move([lib.pages.Proteins, lib.pages.Cell], { parentId: lib.labs, beforeId: null });
    expect(await pageLevels(s, lib.labs)).toBe('Lab 1:0, Cell:0, Membranes:1, Proteins:2');
  }),
  kase('levels.demote-promote', 'makes a page a subpage and promotes it again', async (s) => {
    const lib = await library(s);
    await s.setPageLevel([lib.pages.Meiosis], 1);
    expect(await pageLevels(s, lib.lectures)).toBe('Cell:0, Membranes:1, Proteins:2, Mitosis:0, Meiosis:1');
    await s.setPageLevel([lib.pages.Meiosis], 0);
    expect(await pageLevels(s, lib.lectures)).toBe(LECTURES);
  }),
  kase('levels.shift-subpages', "shifts a page's subpages with it", async (s) => {
    const lib = await library(s);
    await s.setPageLevel([lib.pages.Membranes], 0);
    expect(await pageLevels(s, lib.lectures)).toBe('Cell:0, Membranes:0, Proteins:1, Mitosis:0, Meiosis:0');
  }),
  kase('levels.first-page', 'rejects making the first page a subpage', async (s) => {
    const lib = await library(s);
    await expectNotesError(s.setPageLevel([lib.pages.Cell], 1), 'invalid-move');
    expect(await pageLevels(s, lib.lectures)).toBe(LECTURES);
  }),
  kase('levels.too-deep', 'rejects a level more than one below the page before it', async (s) => {
    const lib = await library(s);
    await expectNotesError(s.setPageLevel([lib.pages.Meiosis], 2), 'invalid-move');
  }),
  kase('levels.past-two', 'rejects a change that would push a subpage past level 2', async (s) => {
    const lib = await library(s);
    await s.setPageLevel([lib.pages.Mitosis], 1);
    await expectNotesError(s.setPageLevel([lib.pages.Cell], 1), 'invalid-move');
    await expectNotesError(s.setPageLevel([lib.pages.Membranes], 2), 'invalid-move');
  }),
  kase('levels.not-page', 'rejects a level for anything but a page', async (s) => {
    const lib = await library(s);
    await expectNotesError(s.setPageLevel([lib.labs], 1), 'invalid-move');
  }),
];
