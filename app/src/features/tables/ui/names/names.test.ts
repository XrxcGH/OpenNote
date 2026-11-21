import { describe, expect, it } from 'vitest';
import { createTable, setCellInput } from '../../engine/edit';
import { EN_US } from '../../engine/locale';
import type { Table, TableName } from '../../engine/model';
import { recalculateBook } from '../../engine/workbook';
import { namesOf } from '../../sheet/model';
import type { Sheet } from '../../sheet/model';
import { defineName, nameFromLabel, nameRows, namesFromSelection, removeName } from './names';

const ENV = { today: () => 45000 };
const COLUMNS = ['A', 'B'].map((name) => ({ name, type: 'number' as const }));

/** The engine table of a sheet's cells with the names the sheet holds, as the smart table reads them. */
function withNames(rows: string[][], sheet: Sheet): Table {
  const names = namesOf(sheet).map((n): TableName => ({ name: n.name, ref: n.ref, scope: n.scope }));
  return { ...createTable(COLUMNS, rows, EN_US, ENV, 1), names };
}

describe('the Name manager', () => {
  it('defines TaxRate = 0.0825 for the page, and =100*TaxRate in another table shows 8.25 (lane test)', () => {
    const defined = defineName([{}, {}], 0, { name: 'TaxRate', ref: '=0.0825', scope: 'page' });
    expect('sheet' in defined).toBe(true);
    const first = (defined as { sheet: Sheet }).sheet;
    expect(first.names).toEqual({ TaxRate: { ref: '0.0825', scope: 'page' } });
    const own = withNames([['1', '']], first);
    const other = setCellInput(withNames([['', '']], {}), { row: 0, col: 1, raw: '=100*TaxRate' }, EN_US, ENV);
    const [, result] = recalculateBook([own, other], ENV);
    // 100 times 0.0825, worked by hand: 8.25.
    expect(result!.rows[0]!.cells[1]!.value).toBe(8.25);
  });

  it('lists the table names and page names a table sees, with conflicts and shadows', () => {
    const sheets: Sheet[] = [
      { names: { Rate: { ref: '1', scope: 'page' }, Local: { ref: '2' } } },
      { names: { Rate: { ref: '3', scope: 'page' } } },
      { names: { Rate: { ref: '4' } } },
    ];
    const seen = nameRows(sheets, 2).map((r) => [r.name, r.table, r.scope, r.conflict, r.shadowed]);
    expect(seen).toEqual([
      ['Rate', 0, 'page', true, true],
      ['Rate', 1, 'page', true, true],
      ['Rate', 2, 'table', false, false],
    ]);
    expect(nameRows(sheets, 0).map((r) => r.name)).toEqual(['Local', 'Rate', 'Rate']);
  });

  it('refuses a page name another table holds, a bad name, and an empty formula', () => {
    const sheets: Sheet[] = [{ names: { Rate: { ref: '1', scope: 'page' } } }, {}];
    expect(defineName(sheets, 1, { name: 'rate', ref: '2', scope: 'page' })).toEqual({ refused: 'taken' });
    expect(defineName(sheets, 1, { name: 'A1', ref: '2', scope: 'table' })).toEqual({ refused: 'name' });
    expect(defineName(sheets, 1, { name: 'Ok', ref: '=', scope: 'table' })).toEqual({ refused: 'ref' });
    expect(removeName(sheets[0]!, 'RATE')).toEqual({});
  });

  it('creates names from the top row or the left column of a selection', () => {
    const texts = [
      ['Item', 'Unit price', '2024'],
      ['Pen', '2', '5'],
      ['Ink', '3', '6'],
    ];
    const box = { top: 0, left: 0, bottom: 2, right: 2 };
    expect(namesFromSelection(texts, box, true, 'top')).toEqual([
      { name: 'Item', ref: '$A$1:$A$2', scope: 'table' },
      { name: 'Unit_price', ref: '$B$1:$B$2', scope: 'table' },
      { name: '_2024', ref: '$C$1:$C$2', scope: 'table' },
    ]);
    expect(namesFromSelection(texts, { top: 1, left: 0, bottom: 2, right: 2 }, true, 'left')).toEqual([
      { name: 'Pen', ref: '$B$1:$C$1', scope: 'table' },
      { name: 'Ink', ref: '$B$2:$C$2', scope: 'table' },
    ]);
    expect(nameFromLabel('  ')).toBeNull();
  });
});
