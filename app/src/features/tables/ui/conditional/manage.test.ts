import { describe, expect, it } from 'vitest';
import { applyPatch } from '../../sheet/model/json';
import { K, R } from '../../sheet/model/testing';
import type { Sheet, TableLike } from '../../sheet/model/types';
import { deleteRule, describeRanges, describeRule, managedRules, moveRule, setStop } from './manage';

const table: TableLike = {
  header: false,
  columns: [{ id: K(1) }, { id: K(2) }],
  rows: [1, 2, 3].map((n) => ({ id: R(n), cells: {} })),
};
const sheet = (): Sheet => ({
  conditional: {
    c1: { ranges: [{ col: K(1) }], order: 1, type: 'cell', op: 'greater', a: '5' },
    c2: { ranges: [{ col: K(2) }], order: 2, type: 'blank', stop: true },
    c3: { ranges: [{ from: [R(1), K(1)], to: [R(2), K(2)] }], order: 3, type: 'top', rank: 5, percent: true },
  },
});

describe('rule manager model', () => {
  it('describes rules in sentences', () => {
    expect(describeRule({ type: 'cell', op: 'greater', a: '5' })).toBe('Cell value is greater than "5"');
    expect(describeRule({ type: 'cell', op: 'between', a: '1', b: '9' })).toBe('Cell value is between "1" and "9"');
    expect(describeRule({ type: 'text', op: 'begins', text: 'ab' })).toBe('Text begins with "ab"');
    expect(describeRule({ type: 'top', rank: 5, percent: true })).toBe('Top 5 percent');
    expect(describeRule({ type: 'top', rank: 3, bottom: true })).toBe('Bottom 3 items');
    expect(describeRule({ type: 'date', period: 'lastWeek' })).toBe('Dates last week');
    expect(describeRule({ type: 'average', below: true })).toBe('Below average');
    expect(describeRule({ type: 'icons', set: '3Arrows' })).toBe('Icon set 3Arrows');
    expect(describeRule({ type: 'future' })).toBe('A rule from a newer version');
  });

  it('describes ranges', () => {
    expect(describeRanges(sheet().conditional?.c1 as never, table)).toBe('column A');
    expect(describeRanges(sheet().conditional?.c3 as never, table)).toBe('cells A1 to B2');
    expect(describeRanges({ ranges: [{ row: R(3) }] }, table)).toBe('row 3');
  });

  it('lists the table in priority order and the selection by overlap', () => {
    expect(managedRules(sheet(), table, 'table').map((r) => r.id)).toEqual(['c1', 'c2', 'c3']);
    const selection = { top: 2, bottom: 2, left: 1, right: 1 };
    expect(managedRules(sheet(), table, 'selection', selection).map((r) => r.id)).toEqual(['c2']);
    expect(managedRules(sheet(), table, 'table')[1]).toMatchObject({ stop: true, summary: 'Blank cells' });
  });

  it('moves a rule, renumbers the orders, and gives a patch that makes the new sheet', () => {
    const before = sheet();
    const moved = moveRule(before, 'c3', -1);
    expect(managedRules(moved.sheet, table, 'table').map((r) => r.id)).toEqual(['c1', 'c3', 'c2']);
    const orders = Object.values(moved.sheet.conditional as Record<string, { order: number }>).map((r) => r.order);
    expect(orders.sort()).toEqual([1, 2, 3]);
    expect(applyPatch(before, (moved.patch as { sheet: never }).sheet)).toEqual(moved.sheet);
    // The first rule cannot go up: nothing changes.
    expect(moveRule(before, 'c1', -1).patch).toBeNull();
  });

  it('sets and clears stop, and deletes a rule', () => {
    const on = setStop(sheet(), 'c1', true);
    expect(managedRules(on.sheet, table, 'table')[0].stop).toBe(true);
    const off = setStop(on.sheet, 'c1', false);
    expect(managedRules(off.sheet, table, 'table')[0].stop).toBe(false);
    const gone = deleteRule(sheet(), 'c2');
    expect(managedRules(gone.sheet, table, 'table').map((r) => r.id)).toEqual(['c1', 'c3']);
    const empty = deleteRule(deleteRule(deleteRule(sheet(), 'c1').sheet, 'c2').sheet, 'c3');
    expect(empty.sheet.conditional).toBeUndefined();
  });
});
