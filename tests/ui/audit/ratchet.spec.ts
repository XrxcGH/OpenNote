// The layout audit's ratchet. It merges what the cells found, writes findings.json, and compares the findings with
// known.json: a finding that is not listed fails, and a listed finding that no longer occurs fails too, so fixing
// something shrinks the list and nothing new gets in. Run the audit with the whole matrix; to accept the current
// findings after a deliberate change, run with OPENNOTE_AUDIT_UPDATE=1.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { OUT_DIR } from './auditor';
import type { Finding } from './auditor';
import { CELLS } from './cells';

const KNOWN = join(import.meta.dirname, 'known.json');

interface CellFile {
  cell: string;
  surfaces: string[];
  findings: Finding[];
}

const keyOf = (one: Finding) => `${one.surface} | ${one.kind} | ${one.selector}`;

test('the layout has no findings beyond the known list', () => {
  const files = readdirSync(OUT_DIR).filter((name) => name.startsWith('cell-') && name.endsWith('.json'));
  const cells = files.map((name) => JSON.parse(readFileSync(join(OUT_DIR, name), 'utf8')) as CellFile);
  const merged = new Map<string, Finding>();
  for (const file of cells) {
    for (const one of file.findings) {
      const have = merged.get(keyOf(one));
      if (have) have.cells = [...new Set([...have.cells, ...one.cells])];
      else merged.set(keyOf(one), { ...one });
    }
  }
  const surfaces = new Set(cells.flatMap((file) => file.surfaces));
  const all = [...merged.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  writeFileSync(
    join(OUT_DIR, 'findings.json'),
    JSON.stringify({ cells: cells.length, surfaces: surfaces.size, findings: all }, null, 1),
  );

  const known: string[] = existsSync(KNOWN) ? (JSON.parse(readFileSync(KNOWN, 'utf8')) as { known: string[] }).known : [];
  if (process.env.OPENNOTE_AUDIT_UPDATE) {
    writeFileSync(KNOWN, `${JSON.stringify({ known: all.map(keyOf) }, null, 1)}\n`);
    return;
  }
  const found = new Set(all.map(keyOf));
  const fresh = [...found].filter((key) => !known.includes(key));
  // A cell the run skipped cannot show that a finding is gone, so the list is checked for staleness only after a full run.
  const full = cells.length === CELLS.length;
  const gone = full ? known.filter((key) => !found.has(key)) : [];
  expect(fresh, 'findings that are not in tests/ui/audit/known.json (fix them, or list them)').toEqual([]);
  expect(gone, 'listed findings that no longer occur (remove them from tests/ui/audit/known.json)').toEqual([]);
});
