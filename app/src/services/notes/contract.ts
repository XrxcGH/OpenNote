// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// The notes contract suite. Every NotesService implementation runs it. The Phase 2 in-memory service runs it in
// Vitest, and Phase 3's storage-backed service in its own harness. Import this file only from tests.
//
// `make` must return a fresh service with an empty library each time.
//
// The semantics it checks, from ARCHITECTURE.md section 12.2:
//
// - Order: listChildren returns display order. move places nodes before beforeId, in the given order.
//
// - Order: beforeId counts among the target's children after the moved nodes are removed. Moving to the same
//   place changes nothing.
//
// - Kinds: notebooks hold section groups and sections, section groups hold both, and sections hold pages.
//
// - Kinds: a move or create that breaks these rules or makes a cycle changes nothing and rejects (invalid-move).
//
// - Kinds: section groups nest at most 4 deep, so a create or move that nests them deeper rejects (invalid-move).
//
// - Levels: a section's first page has level 0. Each page is at most one level below the page before it.
//
// - Levels: a page's subpages are the pages right after it with a higher level. They move and go to Trash with it.
//
// - Levels: a moved page block rises to fit after the page before it. setPageLevel shifts subpages too.
//
// - Names: titles are trimmed and 1 to 200 characters. Pages never have a color, and colors are pen names only.
//
// - Trash: trash returns the roots in display order. restore puts each root back before its old next sibling.
//
// - Trash: without that sibling, restore puts the root at the end. Without the parent, sections and groups go to
//   the end of their notebook. A page goes into a new section at the end of its notebook, named after the old
//   one. A group that would nest too deep also goes to the end of its notebook.
//
// - Trash: while a notebook is in Trash, the items trashed from inside it are hidden and can't be restored.
//
// - Trash: restore(receipt) restores what is left of the receipt, and rejects when nothing is.
//
// - Errors: every method rejects only with NotesError.

import { describe, it } from 'vitest';
import { basicCases, createCases, renameCases } from './contract/cases-basics';
import { loadCases, eventCases } from './contract/cases-load';
import { moveCases, pageMoveCases } from './contract/cases-moves';
import { trashCases } from './contract/cases-trash';
import type { ContractCase, MakeService } from './contract/helpers';
import { propertyCases } from './contract/property';

export type { ContractCase, MakeService } from './contract/helpers';

export interface ContractOptions {
  /** Case ids the implementation doesn't support yet. They show as todo instead of failing. */
  readonly todo?: readonly string[];
}

export const CONTRACT_GROUPS: readonly (readonly [string, readonly ContractCase[]])[] = [
  ['an empty library', basicCases],
  ['creating', createCases],
  ['renaming and colors', renameCases],
  ['moving', moveCases],
  ['pages and subpages', pageMoveCases],
  ['Trash and restore', trashCases],
  ['loading', loadCases],
  ['events and flushing', eventCases],
  ['the reference model', propertyCases],
];

export const CONTRACT_CASE_IDS: readonly string[] = CONTRACT_GROUPS.flatMap(([, cases]) => cases.map((c) => c.id));

export function describeNotesService(name: string, make: MakeService, options: ContractOptions = {}): void {
  const todo = new Set(options.todo ?? []);
  const unknown = [...todo].filter((id) => !CONTRACT_CASE_IDS.includes(id));
  if (unknown.length) throw new Error(`Unknown contract case ids: ${unknown.join(', ')}`);
  describe(`notes contract: ${name}`, () => {
    for (const [group, cases] of CONTRACT_GROUPS) {
      describe(group, () => {
        for (const c of cases) {
          if (todo.has(c.id)) it.todo(c.name);
          else it(c.name, async () => c.run(await make(), make), 30_000);
        }
      });
    }
  });
}
