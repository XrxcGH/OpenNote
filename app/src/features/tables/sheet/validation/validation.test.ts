// Data validation: the lane's four known-answer cases plus every kind, operator, and option. Expected values come
// from the rules of the format spec (R-SHT-14) and from working each case by hand, never from the code's own output.
import { describe, expect, it } from 'vitest';
import { DE_DE, EN_US, createTable } from '../../engine';
import type { ColumnInit, Locale, Table } from '../../engine';
import type { JsonObject } from '../model';
import { applyEdit, applyPaste, check, decide, invalidCells, messageOf, openList, sentenceOf } from './index';
import type { Context } from './index';
import type { FnSpec2 } from '../../engine/formula/fn';
import { err, toNumber } from '../../engine/values';

// ISEVEN is the fn-logic-info lane's function. This stand-in follows its documented behavior (TRUE for an even
// number, #VALUE! for a non-number) so the lane case runs on the engine's `functions` hook.
const ISEVEN: FnSpec2 = {
  name: 'ISEVEN',
  family: 'math',
  params: [{ name: 'number', kind: 'number' }],
  run: ([n]) => {
    const x = toNumber(n);
    return typeof x === 'number' ? Math.floor(Math.abs(x)) % 2 === 0 : err('VALUE');
  },
  meta: { signature: '', example: '' },
};
const ENV = { today: () => 46_000, functions: new Map([['ISEVEN', ISEVEN]]) };

const COLS: ColumnInit[] = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name, type: name === 'E' ? 'text' : 'number' }));
const corner = (row: number, col: number) => [`r${row}`, `c${col}`];

function make(
  data: string[][],
  rules: Record<string, JsonObject>,
  inits: ColumnInit[] = COLS,
  locale: Locale = EN_US,
): Context {
  const table: Table = createTable(inits, data, locale, ENV, 2);
  return { table, sheet: { validation: rules }, locale, env: ENV };
}
const col = (c: number) => ({ col: `c${c}` });
const box = (r1: number, c1: number, r2: number, c2: number) => ({ from: corner(r1, c1), to: corner(r2, c2) });
const grid = (rows: number) => Array.from({ length: rows }, () => ['', '', '', '', '']);

describe('lane case: decimal between 0 and 100', () => {
  const rule = {
    ranges: [col(1)],
    kind: 'decimal',
    op: 'between',
    a: '0',
    b: '100',
    alert: 'stop',
    error: { title: 'Out of range', text: 'Enter 0 to 100.' },
  };
  const data = grid(3);
  data[1][1] = '42';

  it('with reject, 150 is refused with the message and the cell keeps its old value', () => {
    const ctx = make(data, { v1: rule });
    const result = applyEdit(ctx, { row: 1, col: 1 }, '150');
    expect(result.kept).toBe(false);
    expect(result.table).toBe(ctx.table);
    expect(result.table.rows[1].cells[1].raw).toBe('42');
    expect(result.decision.kind).toBe('refuse');
    if (result.decision.kind === 'refuse') {
      expect(messageOf(result.decision.verdict)).toEqual({ title: 'Out of range', text: 'Enter 0 to 100.' });
      expect(sentenceOf(result.decision.verdict)).toContain('Enter 0 to 100.');
    }
    expect(applyEdit(ctx, { row: 1, col: 1 }, '100').kept).toBe(true);
    expect(applyEdit(ctx, { row: 1, col: 1 }, '0').kept).toBe(true);
    expect(applyEdit(ctx, { row: 1, col: 1 }, '-0.5').kept).toBe(false);
  });

  it('with warn, the value is kept after confirmation and circled; without it the old value stays', () => {
    const ctx = make(data, { v1: { ...rule, alert: 'warning' } });
    const no = applyEdit(ctx, { row: 1, col: 1 }, '150');
    expect(no.kept).toBe(false);
    expect(no.decision.kind).toBe('confirm');
    const yes = applyEdit(ctx, { row: 1, col: 1 }, '150', () => true);
    expect(yes.kept).toBe(true);
    expect(yes.table.rows[1].cells[1].raw).toBe('150');
    const circled = invalidCells({ ...ctx, table: yes.table });
    expect(circled.map((c) => [c.row, c.col, c.verdict.reason])).toEqual([[1, 1, 'range']]);
  });

  it('with information, the value is kept and noted', () => {
    const ctx = make(data, { v1: { ...rule, alert: 'information' } });
    const result = applyEdit(ctx, { row: 1, col: 1 }, '150');
    expect(result.kept).toBe(true);
    expect(result.decision.kind).toBe('note');
  });
});

describe('lane case: list from a range', () => {
  it('E2:E4 offers its three values through Alt+Down, and only they are valid', () => {
    const data = grid(4);
    data[1][4] = 'Red';
    data[2][4] = 'Green';
    data[3][4] = 'Blue';
    const ctx = make(data, { v1: { ranges: [col(0)], kind: 'list', source: 'E2:E4' } });
    expect(openList(ctx, { row: 0, col: 0 })).toEqual({ items: ['Red', 'Green', 'Blue'], multi: false, arrow: true });
    expect(check(ctx, { row: 0, col: 0 }, 'green').ok).toBe(true);
    expect(check(ctx, { row: 0, col: 0 }, 'Pink').ok).toBe(false);
    expect(openList(ctx, { row: 0, col: 2 })).toBeNull();
  });

  it('typed items are matched exactly and the arrow can be hidden', () => {
    const ctx = make(grid(2), { v1: { ranges: [col(0)], kind: 'list', items: ['Yes', 'No'], dropDown: false } });
    expect(openList(ctx, { row: 0, col: 0 })?.arrow).toBe(false);
    expect(check(ctx, { row: 0, col: 0 }, 'Yes').ok).toBe(true);
    expect(check(ctx, { row: 0, col: 0 }, 'yes').ok).toBe(false);
  });
});

describe('lane case: custom formula relative to the first cell', () => {
  it('=ISEVEN(B2) on B2:B5 rejects 3 in B4', () => {
    const ctx = make(grid(5), { v1: { ranges: [box(1, 1, 4, 1)], kind: 'custom', a: '=ISEVEN(B2)' } });
    expect(applyEdit(ctx, { row: 3, col: 1 }, '3').kept).toBe(false);
    expect(applyEdit(ctx, { row: 3, col: 1 }, '4').kept).toBe(true);
    expect(applyEdit(ctx, { row: 1, col: 1 }, '3').kept).toBe(false);
    expect(applyEdit(ctx, { row: 0, col: 1 }, '3').kept).toBe(true);
  });

  it('a custom rule sees the other cells', () => {
    const data = grid(3);
    data[1][0] = '10';
    const ctx = make(data, { v1: { ranges: [col(1)], kind: 'custom', a: 'B1<=A1' } });
    expect(check(ctx, { row: 1, col: 1 }, '9').ok).toBe(true);
    expect(check(ctx, { row: 1, col: 1 }, '11').ok).toBe(false);
  });
});

describe('lane case: pasting invalid values', () => {
  it('reports 3 invalid and keeps them, circled', () => {
    const ctx = make(grid(5), { v1: { ranges: [col(1)], kind: 'whole', op: 'between', a: '1', b: '10' } });
    const pasted = applyPaste(ctx, [
      { row: 0, col: 1, text: '5' },
      { row: 1, col: 1, text: '50' },
      { row: 2, col: 1, text: 'x' },
      { row: 3, col: 1, text: '2.5' },
    ]);
    expect(pasted.invalid.map((i) => i.row)).toEqual([1, 2, 3]);
    expect(pasted.table.rows[1].cells[1].raw).toBe('50');
    expect(pasted.table.rows[2].cells[1].raw).toBe('x');
    expect(invalidCells({ ...ctx, table: pasted.table }).map((i) => i.row)).toEqual([1, 2, 3]);
  });

  it('never makes a formula of pasted text', () => {
    const ctx = make(grid(2), { v1: { ranges: [col(1)], kind: 'whole', a: '1', b: '10' } });
    const pasted = applyPaste(ctx, [{ row: 0, col: 1, text: '=1+1' }]);
    expect(pasted.table.rows[0].cells[1].formula).toBeUndefined();
    expect(pasted.invalid).toHaveLength(1);
  });
});

describe('kinds and operators', () => {
  const at = { row: 0, col: 0 };
  const one = (rule: JsonObject, value: string, locale: Locale = EN_US) =>
    check(make(grid(1), { v1: { ranges: [col(0)], ...rule } }, COLS, locale), at, value).ok;

  it('any accepts everything', () => expect(one({ kind: 'any' }, 'whatever')).toBe(true));

  it.each([
    ['between', '2', '5', '2', true],
    ['between', '2', '5', '5', true],
    ['between', '2', '5', '6', false],
    ['notBetween', '2', '5', '6', true],
    ['notBetween', '2', '5', '3', false],
    ['equal', '4', '', '4', true],
    ['equal', '4', '', '5', false],
    ['notEqual', '4', '', '5', true],
    ['notEqual', '4', '', '4', false],
    ['greater', '4', '', '5', true],
    ['greater', '4', '', '4', false],
    ['less', '4', '', '3', true],
    ['less', '4', '', '4', false],
    ['greaterOrEqual', '4', '', '4', true],
    ['greaterOrEqual', '4', '', '3', false],
    ['lessOrEqual', '4', '', '4', true],
    ['lessOrEqual', '4', '', '5', false],
  ])('whole number %s %s %s with %s is %s', (op, a, b, value, ok) => {
    expect(one({ kind: 'whole', op, a, b }, value)).toBe(ok);
  });

  it('whole refuses decimals and text; decimal takes both numbers', () => {
    expect(one({ kind: 'whole', op: 'greater', a: '0' }, '2.5')).toBe(false);
    expect(one({ kind: 'whole', op: 'greater', a: '0' }, 'abc')).toBe(false);
    expect(one({ kind: 'decimal', op: 'greater', a: '0' }, '2.5')).toBe(true);
  });

  it('reads numbers in the convention of the region', () => {
    expect(one({ kind: 'decimal', op: 'lessOrEqual', a: '2,5' }, '2,5', DE_DE)).toBe(true);
    expect(one({ kind: 'decimal', op: 'lessOrEqual', a: '2,5' }, '2,6', DE_DE)).toBe(false);
  });

  it('date compares serials: between 2026-01-01 and 2026-12-31', () => {
    const rule = { kind: 'date', op: 'between', a: '2026-01-01', b: '2026-12-31' };
    expect(one(rule, '2026-06-15')).toBe(true);
    expect(one(rule, '2025-12-31')).toBe(false);
    expect(one(rule, 'soon')).toBe(false);
  });

  it('time compares the time of day: between 9:00 and 17:00', () => {
    const rule = { kind: 'time', op: 'between', a: '9:00', b: '17:00' };
    expect(one(rule, '12:30')).toBe(true);
    expect(one(rule, '5:00 pm')).toBe(true);
    expect(one(rule, '5:01 pm')).toBe(false);
    expect(one(rule, '8:59')).toBe(false);
    expect(one(rule, '25:00')).toBe(false);
  });

  it('text length counts characters', () => {
    expect(one({ kind: 'textLength', op: 'lessOrEqual', a: '5' }, 'hello')).toBe(true);
    expect(one({ kind: 'textLength', op: 'lessOrEqual', a: '5' }, 'hello!')).toBe(false);
    expect(one({ kind: 'textLength', op: 'equal', a: '2' }, '😀😀')).toBe(true);
  });

  it('checkbox takes its two values, TRUE and FALSE by default', () => {
    expect(one({ kind: 'checkbox' }, 'true')).toBe(true);
    expect(one({ kind: 'checkbox' }, 'maybe')).toBe(false);
    expect(one({ kind: 'checkbox', checked: 'Done', unchecked: 'Open' }, 'Done')).toBe(true);
    expect(one({ kind: 'checkbox', checked: 'Done', unchecked: 'Open' }, 'TRUE')).toBe(false);
  });

  it('operands may be formulas: greater than A1', () => {
    const data = grid(2);
    data[0][0] = '10';
    data[1][0] = '100';
    const ctx = make(data, { v1: { ranges: [col(1)], kind: 'decimal', op: 'greater', a: '=A1' } });
    expect(check(ctx, { row: 0, col: 1 }, '11').ok).toBe(true);
    expect(check(ctx, { row: 0, col: 1 }, '10').ok).toBe(false);
    expect(check(ctx, { row: 1, col: 1 }, '50').ok).toBe(false);
  });
});

describe('blanks and messages', () => {
  it('ignore blank (the default) lets an empty value pass; turned off, it does not', () => {
    const at = { row: 0, col: 0 };
    const rule = { ranges: [col(0)], kind: 'whole', a: '1', b: '9' };
    expect(check(make(grid(1), { v1: rule }), at, '').ok).toBe(true);
    const strict = check(make(grid(1), { v1: { ...rule, ignoreBlank: false } }), at, '');
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.reason).toBe('blank');
  });

  it('without its own message an alert uses plain words for the reason', () => {
    const ctx = make(grid(1), { v1: { ranges: [col(0)], kind: 'list', items: ['a'] } });
    const d = decide(ctx, { row: 0, col: 0 }, 'z');
    expect(d.kind).toBe('refuse');
    if (d.kind === 'refuse') expect(messageOf(d.verdict).text).toBe('Pick one of the values in the list.');
  });

  it('typed formulas are not checked', () => {
    const ctx = make(grid(1), { v1: { ranges: [col(0)], kind: 'whole', a: '1', b: '9' } });
    expect(decide(ctx, { row: 0, col: 0 }, '=100*2').kind).toBe('accept');
  });

  it('a rule of a kind this version does not know is ignored', () => {
    const ctx = make(grid(1), { v1: { ranges: [col(0)], kind: 'future' } });
    expect(check(ctx, { row: 0, col: 0 }, 'x').ok).toBe(true);
  });
});

describe('choice columns', () => {
  const inits: ColumnInit[] = [
    { name: 'Status', type: 'choice', options: ['Open', 'Done'] },
    { name: 'Tags', type: 'choice', options: ['a', 'b'], multi: true },
  ];
  const ctx = make(
    [
      ['Open', 'a, b'],
      ['', ''],
    ],
    {},
    inits,
  );

  it('is a column-wide list that leaves the format alone and never refuses typing', () => {
    expect(openList(ctx, { row: 0, col: 0 })).toEqual({ items: ['Open', 'Done'], multi: false, arrow: true });
    expect(openList(ctx, { row: 0, col: 1 })?.multi).toBe(true);
    expect(decide(ctx, { row: 0, col: 0 }, 'Other').kind).toBe('note');
    expect(ctx.table.columns[0].type).toBe('choice');
    expect(check(ctx, { row: 0, col: 1 }, 'a, b').ok).toBe(true);
    expect(check(ctx, { row: 0, col: 1 }, 'a, z').ok).toBe(false);
  });

  it('an explicit rule on the column wins', () => {
    const own = make([['Open']], { v1: { ranges: [col(0)], kind: 'list', items: ['Open'], alert: 'stop' } }, [
      inits[0],
    ]);
    expect(decide(own, { row: 0, col: 0 }, 'Done').kind).toBe('refuse');
  });
});

describe('circle invalid data', () => {
  it('finds invalid values in reading order across rules, and runs custom formulas in one pass', () => {
    const data = grid(40);
    for (let r = 0; r < 40; r++) data[r][1] = String(r + 1);
    const ctx = make(data, {
      v1: { ranges: [col(1)], kind: 'custom', a: '=ISEVEN(B1)' },
      v2: { ranges: [col(0)], kind: 'list', items: ['x'], ignoreBlank: false },
    });
    const bad = invalidCells(ctx);
    expect(bad.filter((b) => b.col === 1)).toHaveLength(20);
    expect(bad.filter((b) => b.col === 0)).toHaveLength(40);
    expect(bad.slice(0, 3).map((b) => [b.row, b.col])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
  });
});

describe('hostile and large inputs', () => {
  it('a list source far outside the table is read in bounded time and offers only what exists', () => {
    const data = grid(4);
    data[1][4] = 'Red';
    const ctx = make(data, { v1: { ranges: [col(0)], kind: 'list', source: 'A1:ZZZ9999999' } });
    const start = Date.now();
    const offer = openList(ctx, { row: 0, col: 0 });
    expect(offer?.items).toContain('Red');
    expect(check(ctx, { row: 0, col: 0 }, 'Red').ok).toBe(true);
    expect(invalidCells(ctx)).toBeDefined();
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('repeated values in a range source are offered once', () => {
    const data = grid(4);
    data[0][4] = 'Red';
    data[1][4] = 'Red';
    data[2][4] = 'Blue';
    const ctx = make(data, { v1: { ranges: [col(0)], kind: 'list', source: 'E1:E3' } });
    expect(openList(ctx, { row: 0, col: 0 })?.items).toEqual(['Red', 'Blue']);
  });

  it('circling 3,000 rows with formula operands stays fast and right', () => {
    const data = grid(3000);
    for (let r = 0; r < 3000; r++) {
      data[r][0] = String(r);
      data[r][1] = String(r % 10 === 0 ? r + 50 : r + 5);
    }
    const ctx = make(data, {
      v1: { ranges: [col(1)], kind: 'decimal', op: 'between', a: '=A1', b: '=A1+10' },
    });
    const start = Date.now();
    const bad = invalidCells(ctx);
    expect(bad).toHaveLength(300);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe('rule with several ranges', () => {
  it('relative references count from the first range, as in Excel', () => {
    const data = grid(4);
    data[1][0] = '5';
    data[2][0] = '-1';
    data[1][2] = '5';
    data[2][2] = '5';
    const ctx = make(data, {
      v1: { ranges: [box(1, 1, 2, 1), box(1, 3, 2, 3)], kind: 'custom', a: '=A2>0' },
    });
    // D3 reads C3 (5, valid), not A3 (-1).
    expect(applyEdit(ctx, { row: 2, col: 3 }, '1').kept).toBe(true);
    // B3 reads A3 (-1).
    expect(applyEdit(ctx, { row: 2, col: 1 }, '1').kept).toBe(false);
  });
});
