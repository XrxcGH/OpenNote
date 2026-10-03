import { describe, expect, it } from 'vitest';
import { parseCanonical, toCanonical } from './canonical';
import { daysToIso, excelSerialToDays, parseDate } from './dates';
import { formatValue } from './format';
import { DE_DE, EN_US, FR_FR, parseLocaleNumber, parseNumeric } from './locale';
import { columnLetter, isMismatch, letterToColumn, parseInput, type Column } from './model';
import { err, parseCanonicalNumber } from './values';

const NARROW_SPACE = String.fromCharCode(0x202f);
const column = (type: Column['type'], extra: Partial<Column> = {}): Column => ({ id: 'c', name: 'C', type, ...extra });

describe('reading numbers', () => {
  it.each([
    ['1,234.50', EN_US, 1234.5],
    ['(12.5)', EN_US, -12.5],
    ['-3', EN_US, -3],
    ['1e3', EN_US, 1000],
    ['.5', EN_US, 0.5],
    ['1.234,5', DE_DE, 1234.5],
    ['1.234', DE_DE, 1234],
    [`1${NARROW_SPACE}234,5`, FR_FR, 1234.5],
    ['1 234,5', FR_FR, 1234.5],
  ])('reads %j', (text, locale, expected) => {
    expect(parseLocaleNumber(text, locale)?.value).toBe(expected);
  });

  it.each(['abc', '', '1,23,456', '12 34', 'SKU123', '1.2.3', '$', '--5'])('refuses %j', (text) => {
    expect(parseLocaleNumber(text, EN_US)).toBeNull();
  });

  it('reads currency symbols, codes, percent signs, and decimals', () => {
    expect(parseLocaleNumber('$1,000', EN_US)).toMatchObject({ value: 1000, currency: 'USD', decimals: 0 });
    expect(parseLocaleNumber('12,50 \u20ac', DE_DE)).toMatchObject({ value: 12.5, currency: 'EUR', decimals: 2 });
    expect(parseLocaleNumber('-$5', EN_US)).toMatchObject({ value: -5, currency: 'USD' });
    expect(parseLocaleNumber('25%', EN_US)).toMatchObject({ value: 25, percent: true });
    expect(parseLocaleNumber('EUR 3', EN_US)?.currency).toBe('EUR');
  });

  it('needs groups of exactly three after a group separator, so the other convention can win a vote', () => {
    expect(parseNumeric('1234.56', ',', '.')).toBeNull();
    expect(parseNumeric('1234.56', '.', ',')?.value).toBe(1234.56);
  });
});

describe('reading dates', () => {
  it.each([
    ['2026-09-30', 'mdy', '2026-09-30'],
    ['9/30/2026', 'mdy', '2026-09-30'],
    ['30.09.2026', 'dmy', '2026-09-30'],
    ['Sep 30, 2026', 'mdy', '2026-09-30'],
    ['30 September 2026', 'dmy', '2026-09-30'],
    ['30-Sep-26', 'dmy', '2026-09-30'],
    ['2026-09-30T14:05', 'mdy', '2026-09-30T14:05'],
    ['1/2/49', 'mdy', '2049-01-02'],
    ['1/2/50', 'mdy', '1950-01-02'],
    ['29/2/2024', 'dmy', '2024-02-29'],
  ])('reads %j in %s order', (text, order, iso) => {
    const days = parseDate(text, order as 'mdy' | 'dmy');
    expect(days === null ? null : daysToIso(days)).toBe(iso);
  });

  it.each([
    ['13/01/2026', 'mdy'],
    ['2026-02-30', 'mdy'],
    ['29/2/2025', 'dmy'],
    ['Smarch 3, 2026', 'mdy'],
    ['hello', 'mdy'],
  ])('refuses %j in %s order', (text, order) => {
    expect(parseDate(text, order as 'mdy' | 'dmy')).toBeNull();
  });

  it('counts days since 1970, and converts Excel serials', () => {
    expect(parseDate('1970-01-02', 'mdy')).toBe(1);
    expect(daysToIso(excelSerialToDays(45565))).toBe('2024-09-30');
    expect(daysToIso(excelSerialToDays(61))).toBe('1900-03-01');
    expect(daysToIso(-1)).toBe('1969-12-31');
  });
});

describe('typed input', () => {
  it('reads each column type in the regional format', () => {
    expect(parseInput(column('number'), '1,5', DE_DE)).toBe(1.5);
    expect(parseInput(column('currency'), '$12.50', EN_US)).toBe(12.5);
    expect(parseInput(column('percent'), '25', EN_US)).toBe(0.25);
    expect(parseInput(column('percent'), '25%', EN_US)).toBe(0.25);
    expect(parseInput(column('number'), '7%', EN_US)).toBe(0.07);
    expect(parseInput(column('date'), '30.09.2026', DE_DE)).toBe(20726);
    expect(parseInput(column('checkbox'), 'Yes', EN_US)).toBe(true);
    expect(parseInput(column('checkbox'), '[ ]', EN_US)).toBe(false);
    expect(parseInput(column('text'), ' a ', EN_US)).toBe(' a ');
    expect(parseInput(column('number'), '  ', EN_US)).toBeNull();
  });

  it('keeps text that does not fit the type, and flags it', () => {
    const cell = { raw: '1,234', value: parseInput(column('number'), 'many', EN_US) };
    expect(cell.value).toBe('many');
    expect(isMismatch(column('number'), cell)).toBe(true);
    expect(isMismatch(column('text'), cell)).toBe(false);
    expect(isMismatch(column('number', { formula: '1' }), cell)).toBe(false);
  });

  it('names columns with spreadsheet letters', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(['A', 'z', 'AA', 'ZZ', '1', 'AAAA'].map(letterToColumn)).toEqual([0, 25, 26, 701, -1, -1]);
  });
});

describe('canonical text', () => {
  it.each([
    ['number', 1234.5, '1234.5'],
    ['number', -3, '-3'],
    ['number', 1e21, '1e+21'],
    ['percent', 0.25, '0.25'],
    ['date', 20726, '2026-09-30'],
    ['date', 20726.5, '2026-09-30T12:00'],
    ['checkbox', true, '[x]'],
    ['checkbox', false, '[ ]'],
    ['text', '**Seed** trays', '**Seed** trays'],
    ['number', null, ''],
    ['number', err('DIV0'), '#DIV/0!'],
    ['number', err('CYCLE'), '#REF!'],
  ] as const)('writes %s %j as %j and reads it back', (type, value, text) => {
    expect(toCanonical(type, value)).toBe(text);
    if (typeof value !== 'object' || value === null) expect(parseCanonical(type, text)).toBe(value);
  });

  it('rounds to 15 digits, so 0.1 + 0.2 is written 0.3', () => {
    expect(toCanonical('number', 0.1 + 0.2)).toBe('0.3');
  });

  it('reads Markdown-escaped forms and keeps non-canonical text as text', () => {
    expect(parseCanonical('number', '\\-3')).toBe(-3);
    expect(parseCanonical('number', '12\\.5')).toBe(12.5);
    expect(parseCanonical('checkbox', '\\[x\\]')).toBe(true);
    expect(parseCanonical('number', '\\#DIV/0!')).toEqual(err('DIV0'));
    expect(parseCanonical('number', '1,234')).toBe('1,234');
    expect(parseCanonical('date', '9/30/2026')).toBe('9/30/2026');
  });
});

describe('display text', () => {
  it('uses the regional format, not the interface language', () => {
    expect(formatValue(1234.5, column('number'), EN_US)).toBe('1,234.5');
    expect(formatValue(1234.5, column('number'), DE_DE)).toBe('1.234,5');
    expect(formatValue(1234.5, column('currency', { currency: 'EUR' }), DE_DE)).toMatch(/^1\.234,50\s\u20ac$/);
    expect(formatValue(1234.5, column('currency'), EN_US)).toBe('$1,234.50');
    expect(formatValue(0.256, column('percent'), EN_US)).toBe('25.6%');
    expect(formatValue(0.256, column('percent', { decimals: 0 }), EN_US)).toBe('26%');
    expect(formatValue(3.14159, column('number', { decimals: 2 }), EN_US)).toBe('3.14');
    expect(formatValue(20726, column('date'), EN_US)).toBe('Sep 30, 2026');
  });

  it('shows errors as words and text in typed columns as typed', () => {
    expect(formatValue(err('DIV0'), column('number'), EN_US)).toBe('Divide by 0');
    expect(formatValue('many', column('number'), EN_US)).toBe('many');
    expect(formatValue(true, column('checkbox'), EN_US)).toBe('[x]');
    expect(formatValue(null, column('number'), EN_US)).toBe('');
  });
});

describe('number text', () => {
  it('reads canonical numbers, and long text without backtracking', () => {
    expect(parseCanonicalNumber('-1.5e3')).toBe(-1500);
    expect(parseCanonicalNumber('2\\.5')).toBe(2.5);
    expect(parseCanonicalNumber('.5')).toBe(0.5);
    expect(parseCanonicalNumber('1.')).toBe(1);
    expect(parseCanonicalNumber('1e')).toBeNull();
    const started = performance.now();
    expect(parseCanonicalNumber(`${'1'.repeat(300)}x`)).toBeNull();
    expect(parseCanonicalNumber(`${'1'.repeat(40000)}x`)).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });
});
