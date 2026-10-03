// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// Seed libraries for development, tests, and screenshots, with fixed ids and dates so every run looks the same.
// The web platform seeds its notes from one of these, and the Phase 2 snapshot uses the same shape.

import type { ChipColor, NodeKind, PageLevel } from './types';

export interface FixtureNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly title: string;
  readonly color?: ChipColor | null;
  /** Pages only. Subpages are pages with level 1 or 2 placed after their parent page. */
  readonly pageLevel?: PageLevel;
  readonly created?: string;
  readonly modified?: string;
  readonly readOnly?: boolean;
  /** Containers only, in display order. A section's children are its pages. */
  readonly children?: readonly FixtureNode[];
}

export interface FixtureData {
  readonly folder: string;
  readonly readOnly?: boolean;
  readonly notebooks: readonly FixtureNode[];
}

export type FixtureName = 'sample' | 'empty' | 'large' | 'deep';
export type NotesFixture = FixtureName | FixtureData;

export const FIXTURE_NAMES: readonly FixtureName[] = ['sample', 'empty', 'large', 'deep'];
const FOLDER = 'C:\\Users\\Ada\\Documents\\OpenNote';
const CREATED = '2026-09-01T09:00:00.000Z';

function day(date: string): string {
  return `2026-${date}T10:00:00.000Z`;
}

function page(id: string, title: string, date: string, pageLevel: PageLevel = 0): FixtureNode {
  return { id, kind: 'page', title, pageLevel, created: day(date), modified: day(date) };
}

function section(id: string, title: string, color: ChipColor | null, children: FixtureNode[] = []): FixtureNode {
  return { id, kind: 'section', title, color, created: CREATED, modified: CREATED, children };
}

function group(id: string, title: string, children: FixtureNode[]): FixtureNode {
  return { id, kind: 'sectionGroup', title, color: null, created: CREATED, modified: CREATED, children };
}

function notebook(id: string, title: string, color: ChipColor, children: FixtureNode[]): FixtureNode {
  return { id, kind: 'notebook', title, color, created: CREATED, modified: CREATED, children };
}

/** Matches the wireframes: Biology 101, Work, Personal, Recipes, and Travel. */
export function sample(): FixtureData {
  const lectures = section('s-lectures', 'Lectures', 'fern', [
    page('p-cell-structure', 'Cell structure', '09-28'),
    page('p-membranes', 'Membranes', '09-28', 1),
    page('p-mitosis', 'Mitosis', '09-23'),
    page('p-meiosis', 'Meiosis', '09-21'),
    page('p-photosynthesis', 'Photosynthesis', '09-16'),
  ]);
  const labs = section('s-labs', 'Labs', 'amber', [page('p-photosynthesis-lab', 'Photosynthesis lab', '09-18')]);
  const examPrep = group('g-exam-prep', 'Exam prep', [
    section('s-midterm', 'Midterm', 'plum', [page('p-midterm-topics', 'Topics to review', '09-25')]),
    section('s-final', 'Final', 'indigo'),
  ]);
  return {
    folder: FOLDER,
    notebooks: [
      notebook('n-biology', 'Biology 101', 'fern', [lectures, labs, examPrep]),
      notebook('n-work', 'Work', 'brick', [
        section('s-meetings', 'Meetings', 'brick', [page('p-weekly-sync', 'Weekly sync', '09-29')]),
        section('s-projects', 'Projects', 'walnut', [page('p-roadmap', 'Roadmap', '09-10')]),
      ]),
      notebook('n-personal', 'Personal', 'plum', [section('s-journal', 'Journal', 'plum')]),
      notebook('n-recipes', 'Recipes', 'amber', [section('s-baking', 'Baking', 'amber')]),
      notebook('n-travel', 'Travel', 'indigo', [section('s-trips', 'Trips', 'indigo')]),
    ],
  };
}

export function empty(): FixtureData {
  return { folder: FOLDER, notebooks: [] };
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const LARGE_PENS: readonly ChipColor[] = ['fern', 'brick', 'plum', 'amber', 'indigo'];

/** 5 notebooks, 50 sections, and 1,000 pages in the first section, for performance tests. */
export function large(): FixtureData {
  const pages = Array.from({ length: 1000 }, (_, i) =>
    page(`lg-p-${pad(i + 1, 4)}`, `Page ${i + 1}`, `09-${pad((i % 28) + 1, 2)}`),
  );
  const notebooks = LARGE_PENS.map((color, n) =>
    notebook(
      `lg-n-${n + 1}`,
      `Notebook ${n + 1}`,
      color,
      Array.from({ length: 10 }, (_, s) =>
        section(`lg-s-${n + 1}-${s + 1}`, `Section ${s + 1}`, color, n === 0 && s === 0 ? pages : []),
      ),
    ),
  );
  return { folder: FOLDER, notebooks };
}

/** Section groups nested four deep, with subpages at every level. */
export function deep(): FixtureData {
  const leaf = section('d-s-leaf', 'Innermost section', 'fern', [
    page('d-p-1', 'Top page', '09-01'),
    page('d-p-2', 'Subpage', '09-02', 1),
    page('d-p-3', 'Sub-subpage', '09-03', 2),
    page('d-p-4', 'Second top page', '09-04'),
  ]);
  let inner: FixtureNode = leaf;
  for (let depth = 4; depth >= 1; depth -= 1) inner = group(`d-g-${depth}`, `Group level ${depth}`, [inner]);
  return { folder: FOLDER, notebooks: [notebook('d-n-1', 'Deep notebook', 'indigo', [inner])] };
}

const BY_NAME: Record<FixtureName, () => FixtureData> = { sample, empty, large, deep };

export function isFixtureName(value: unknown): value is FixtureName {
  return typeof value === 'string' && (FIXTURE_NAMES as readonly string[]).includes(value);
}

export function resolveFixture(fixture: NotesFixture): FixtureData {
  return typeof fixture === 'string' ? BY_NAME[fixture]() : fixture;
}

const KINDS: readonly string[] = ['notebook', 'sectionGroup', 'section', 'page'];

function isFixtureNode(value: unknown): value is FixtureNode {
  if (typeof value !== 'object' || value === null) return false;
  const node = value as Record<string, unknown>;
  const children = node.children;
  return (
    typeof node.id === 'string' &&
    typeof node.title === 'string' &&
    KINDS.includes(node.kind as string) &&
    (children === undefined || (Array.isArray(children) && children.every(isFixtureNode)))
  );
}

/** Reads fixture JSON, such as a saved snapshot. Returns null for anything that isn't a fixture. */
export function parseFixture(json: string): FixtureData | null {
  try {
    const value = JSON.parse(json) as Record<string, unknown> | null;
    if (!value || typeof value.folder !== 'string' || !Array.isArray(value.notebooks)) return null;
    return value.notebooks.every(isFixtureNode) ? (value as unknown as FixtureData) : null;
  } catch {
    return null;
  }
}
