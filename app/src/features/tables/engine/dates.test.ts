// Spreadsheet date serials (ADR 0058): day 0 is 1899-12-30. Expected serials are worked by hand from the calendar:
// 1900-01-01 is serial 2 (two days after day 0), 1900 has 365 days and 1900-03-01 is day 60 of 1900, so serial 61.
// The two modern dates match the serials Excel and Sheets document for them.

import { describe, expect, it } from 'vitest';
import { buildChartSpec } from './chart';
import { xText } from './chart/describe';
import {
  dateToSerial,
  daysToIso,
  daysToYmd,
  excelSerialToDays,
  parseIsoDate,
  serialToDate,
  todayDays,
  weekdayOf,
  ymdToDays,
} from './dates';
import { createTable, setColumnFormula } from './edit';
import { formatValue } from './format';
import { EN_US } from './locale';
import { monthWeeks } from '../smart/viewLogic';

function formula(text: string): unknown {
  const base = createTable([{ name: 'Out' }], [['']], EN_US);
  const result = setColumnFormula(base, 0, text);
  if (!result.ok) throw new Error(result.problem.message);
  return result.table.rows[0].cells[0].value;
}

describe('serials', () => {
  it.each([
    ['DATE(2024,1,1)', 45292],
    ['DATE(1900,3,1)', 61],
    ['DATE(1899,12,30)', 0],
    ['DATE(1900,1,1)', 2],
    ['DATE(1899,12,29)', -1],
    ['DATE(2024,13,1)', 45658],
    ['DATE(2024,3,0)', 45351],
  ])('=%s is %d', (text, serial) => {
    expect(formula(text)).toBe(serial);
  });

  it('reads ISO text as a serial', () => {
    expect(parseIsoDate('2026-11-01')).toBe(46327);
    expect(parseIsoDate('1899-12-30')).toBe(0);
    expect(parseIsoDate('2026-11-01T12:00')).toBe(46327.5);
    expect(ymdToDays(2024, 2, 30)).toBeNull();
  });

  it('writes serials back as the same calendar days', () => {
    expect(daysToIso(46327)).toBe('2026-11-01');
    expect(daysToIso(0)).toBe('1899-12-30');
    expect(daysToIso(-1)).toBe('1899-12-29');
    expect(daysToIso(45292.25)).toBe('2024-01-01T06:00');
    expect(daysToYmd(61)).toEqual({ y: 1900, m: 3, d: 1 });
  });

  it('turns serials into moments and back only through the two helpers', () => {
    expect(serialToDate(25569)).toEqual(new Date(0));
    expect(dateToSerial(new Date(Date.UTC(2026, 10, 1)))).toBe(46327);
    expect(dateToSerial(serialToDate(45292.75))).toBe(45292.75);
    expect(todayDays(new Date(2026, 10, 1, 23, 30))).toBe(46327);
  });

  it('knows the weekday: day 0 was a Saturday, 2026-11-01 a Sunday', () => {
    expect(weekdayOf(0)).toBe(6);
    expect(weekdayOf(46327)).toBe(0);
    expect(weekdayOf(-1)).toBe(5);
  });

  it('reads Excel serials, which count a false 1900-02-29', () => {
    expect(excelSerialToDays(1)).toBe(2);
    expect(excelSerialToDays(59)).toBe(60);
    expect(excelSerialToDays(61)).toBe(61);
    expect(excelSerialToDays(45292)).toBe(45292);
  });

  it('subtracts dates as days and shows a date column as before', () => {
    expect(formula('DATE(2024,3,1)-DATE(2024,2,1)')).toBe(29);
    expect(formatValue(46327, { id: 'c0', name: 'Day', type: 'date' }, EN_US)).toBe('Nov 1, 2026');
  });
});

describe('charts and calendar views show the same dates as before', () => {
  const table = createTable(
    [
      { name: 'Day', type: 'date' },
      { name: 'Seeds', type: 'number' },
    ],
    [
      ['2026-01-01', '1'],
      ['2026-02-28', '2'],
      ['2026-11-01', '3'],
    ],
    EN_US,
  );

  it('puts the same Date objects in the chart spec', () => {
    const spec = buildChartSpec(table, [0, 1, 2], { kind: 'line', x: 0, series: [1] }, EN_US);
    const xs = (spec.plot?.marks[0].data as { x: Date }[]).map((p) => p.x.toISOString());
    expect(xs).toMatchInlineSnapshot(`
      [
        "2026-01-01T00:00:00.000Z",
        "2026-02-28T00:00:00.000Z",
        "2026-11-01T00:00:00.000Z",
      ]
    `);
    expect(xText(46327, 'date')).toBe('2026-11-01');
  });

  it('starts a calendar month on the same Sunday', () => {
    const weeks = monthWeeks({ year: 2026, month: 11 });
    expect(daysToIso(weeks[0][0])).toBe('2026-11-01');
    const march = monthWeeks({ year: 2026, month: 3 });
    expect(daysToIso(march[0][0])).toBe('2026-03-01');
    const january = monthWeeks({ year: 2026, month: 1 });
    expect(daysToIso(january[0][0])).toBe('2025-12-28');
    expect(january[0].map(weekdayOf)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
