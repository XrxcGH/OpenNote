// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// Helpers for the contract cases: building a small library through the service, and checking errors.

import { expect } from 'vitest';
import { NotesError } from '../errors';
import type { InvalidNameReason, NotesErrorCode } from '../errors';
import type { CreateInput, NodeId, NodeKind, NotesService, NodeSummary, PageLevel } from '../types';

export type MakeService = () => Promise<NotesService>;

export interface ContractCase {
  /** Stable id, used to mark a case as todo for an unfinished implementation. */
  readonly id: string;
  readonly name: string;
  run(service: NotesService, make: MakeService): Promise<void>;
}

export const kase = (id: string, name: string, run: ContractCase['run']): ContractCase => ({ id, name, run });

export function add(
  service: NotesService,
  parentId: NodeId | null,
  kind: NodeKind,
  title: string,
  extra: Partial<Omit<CreateInput, 'kind' | 'title'>> = {},
): Promise<NodeSummary> {
  return service.create({ kind, title, placement: { parentId, beforeId: null }, ...extra });
}

export async function titles(service: NotesService, parentId: NodeId | null): Promise<string[]> {
  const nodes = parentId === null ? await service.listNotebooks() : await service.listChildren(parentId);
  return nodes.map((node) => node.title);
}

/** Titles with their levels, such as "Cell:0, Membranes:1", for checking subpages. */
export async function pageLevels(service: NotesService, sectionId: NodeId): Promise<string> {
  return (await service.listChildren(sectionId)).map((page) => `${page.title}:${page.pageLevel}`).join(', ');
}

export async function expectNotesError(
  promise: Promise<unknown>,
  code: NotesErrorCode,
  reason?: InvalidNameReason,
): Promise<NotesError> {
  const error: unknown = await promise.then(
    () => new Error(`Expected a NotesError with code ${code}, but it resolved`),
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(NotesError);
  const notesError = error as NotesError;
  expect(notesError.code).toBe(code);
  if (reason) expect(notesError.reason).toBe(reason);
  return notesError;
}

export async function addPages(
  service: NotesService,
  sectionId: NodeId,
  pages: readonly [string, PageLevel][],
): Promise<Record<string, NodeId>> {
  const ids: Record<string, NodeId> = {};
  for (const [title, pageLevel] of pages) ids[title] = (await add(service, sectionId, 'page', title, { pageLevel })).id;
  return ids;
}

export interface Library {
  readonly biology: NodeId;
  readonly work: NodeId;
  readonly lectures: NodeId;
  readonly labs: NodeId;
  readonly exams: NodeId;
  readonly midterm: NodeId;
  readonly meetings: NodeId;
  readonly pages: Record<string, NodeId>;
}

/**
 * Biology (Lectures: Cell, Membranes 1, Proteins 2, Mitosis, Meiosis; Labs: Lab 1; Exam prep: Midterm: Topics)
 * and Work (Meetings), built through the service.
 */
export async function library(service: NotesService): Promise<Library> {
  const biology = (await add(service, null, 'notebook', 'Biology', { color: 'fern' })).id;
  const work = (await add(service, null, 'notebook', 'Work')).id;
  const lectures = (await add(service, biology, 'section', 'Lectures')).id;
  const labs = (await add(service, biology, 'section', 'Labs')).id;
  const exams = (await add(service, biology, 'sectionGroup', 'Exam prep')).id;
  const midterm = (await add(service, exams, 'section', 'Midterm')).id;
  const meetings = (await add(service, work, 'section', 'Meetings')).id;
  const pages = {
    ...(await addPages(service, lectures, [
      ['Cell', 0],
      ['Membranes', 1],
      ['Proteins', 2],
      ['Mitosis', 0],
      ['Meiosis', 0],
    ])),
    ...(await addPages(service, labs, [['Lab 1', 0]])),
    ...(await addPages(service, midterm, [['Topics', 0]])),
  };
  return { biology, work, lectures, labs, exams, midterm, meetings, pages };
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
