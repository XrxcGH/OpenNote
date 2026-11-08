// The table commands as changes to data (ARCHITECTURE.md section 13). Inserting, deleting, and moving lines tell the
// registered spreadsheet code what changed, in the formulas' coordinates (A1's row 1 is the first body row); the
// editor itself does not know formulas. The reference rewriting is tested where it lives, in
// features/tables/sheet/structure/reflow.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import type { TableData } from '../schema/specs';
import { applyTableOp, isStructureOp, setTableHooks } from './tables';
import type { LineChange, TableChange, TableOp } from './tables';

function table(rows: number, columns: number, header = false): TableData {
  const cols = Array.from({ length: columns }, (_, c) => ({ id: `k${c}`, width: 160 }));
  return {
    header,
    columns: cols,
    rows: Array.from({ length: rows }, (_, r) => ({
      id: `r${r}`,
      cells: Object.fromEntries(cols.map((c) => [c.id, { markdown: '' }])),
    })),
  };
}

const seen: { change: LineChange; sheet: unknown }[] = [];
const structureOps: TableOp[] = [];

function install() {
  setTableHooks({
    structure: (data, at, op) => {
      structureOps.push(op);
      return { data, caret: at, extra: { sheet: { table: {} } } };
    },
    follow: (_before, applied, change, sheet) => {
      seen.push({ change, sheet });
      return { ...applied, extra: { sheet: null } };
    },
  });
}

afterEach(() => {
  setTableHooks(null);
  seen.length = 0;
  structureOps.length = 0;
});

const at = (row: number, column: number) => ({ row, column });

describe('line changes handed to the spreadsheet', () => {
  it('names each insert, delete, and move in the formulas coordinates', () => {
    install();
    const t = table(4, 3);
    const run = (op: TableOp, row: number, column: number) => applyTableOp(t, at(row, column), op, 'stored');
    run({ op: 'rowAbove' }, 1, 0);
    run({ op: 'rowBelow' }, 1, 0);
    run({ op: 'columnLeft' }, 0, 1);
    run({ op: 'columnRight' }, 0, 1);
    run({ op: 'deleteRow' }, 2, 0);
    run({ op: 'deleteColumn' }, 0, 2);
    run({ op: 'moveRowUp' }, 2, 0);
    run({ op: 'moveRowDown' }, 1, 0);
    expect(seen.map((s) => s.change)).toEqual([
      { kind: 'insertRows', at: 1, count: 1 },
      { kind: 'insertRows', at: 2, count: 1 },
      { kind: 'insertCols', at: 1, count: 1 },
      { kind: 'insertCols', at: 2, count: 1 },
      { kind: 'deleteRows', at: 2, count: 1 },
      { kind: 'deleteCols', at: 2, count: 1 },
      { kind: 'moveRows', from: 2, count: 1, to: 1 },
      { kind: 'moveRows', from: 1, count: 1, to: 2 },
    ]);
    expect(seen.every((s) => s.sheet === 'stored')).toBe(true);
  });

  it('counts rows from the first body row when the table has a header', () => {
    install();
    const t = table(4, 2, true);
    applyTableOp(t, at(0, 0), { op: 'rowAbove' }, undefined); // above the header: a new first body row
    applyTableOp(t, at(0, 0), { op: 'rowBelow' }, undefined);
    applyTableOp(t, at(2, 0), { op: 'deleteRow' }, undefined);
    applyTableOp(t, at(0, 0), { op: 'deleteRow' }, undefined); // the header row is not part of the formulas
    expect(seen.map((s) => s.change)).toEqual([
      { kind: 'insertRows', at: 0, count: 1 },
      { kind: 'insertRows', at: 0, count: 1 },
      { kind: 'deleteRows', at: 1, count: 1 },
    ]);
  });

  it('gives back the spreadsheet patch in extra, and leaves other ops alone', () => {
    install();
    const t = table(3, 2);
    const grown = applyTableOp(t, at(0, 0), { op: 'rowBelow' }, undefined) as TableChange;
    expect(grown.extra).toEqual({ sheet: null });
    expect(grown.data.rows).toHaveLength(4);
    seen.length = 0;
    expect(applyTableOp(t, at(0, 0), { op: 'columnWidth', width: 90 }, undefined)?.extra).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it('turning the header on deletes the first body row from the formulas, and turning it off inserts one', () => {
    install();
    applyTableOp(table(3, 2), at(0, 0), { op: 'headerRow' }, undefined);
    applyTableOp(table(3, 2, true), at(1, 0), { op: 'headerRow' }, undefined);
    expect(seen.map((s) => s.change)).toEqual([
      { kind: 'deleteRows', at: 0, count: 1 },
      { kind: 'insertRows', at: 0, count: 1 },
    ]);
  });

  it('does not ask about an op that did not apply', () => {
    install();
    expect(applyTableOp(table(1, 1), at(0, 0), { op: 'deleteRow' }, undefined)).toBeNull();
    expect(seen).toEqual([]);
  });

  it('works as a plain grid without the spreadsheet registered', () => {
    const grown = applyTableOp(table(2, 2), at(0, 0), { op: 'rowBelow' }, undefined)!;
    expect(grown.data.rows).toHaveLength(3);
    expect(grown.extra).toBeUndefined();
  });
});

describe('structure ops', () => {
  it('go to the registered code, and mean nothing without it', () => {
    const op: TableOp = { op: 'hideRows' };
    expect(isStructureOp(op)).toBe(true);
    expect(isStructureOp({ op: 'rowAbove' })).toBe(false);
    expect(applyTableOp(table(2, 2), at(1, 1), op, undefined)).toBeNull();
    install();
    expect(applyTableOp(table(2, 2), at(1, 1), op, undefined)?.caret).toEqual(at(1, 1));
    expect(structureOps).toEqual([op]);
  });
});
