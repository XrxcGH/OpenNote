// Column types map to format codes when no cell sets `fmt` (DESIGN.md section 5.3). The cells must show what they
// showed before codes: the expectations of model.test.ts, and the same text `Intl` gave for typical values.

import { describe, expect, it } from 'vitest';
import { columnCode, formatValue, renderValue } from '../format';
import { DE_DE, EN_US, FR_FR, type Locale } from '../locale';
import type { Column, ColumnType } from '../model';

const column = (type: ColumnType, extra: Partial<Column> = {}): Column => ({ id: 'c', name: 'C', type, ...extra });

describe('column type presets', () => {
  it('maps column types to codes', () => {
    expect(columnCode(column('number', { decimals: 2 }), EN_US)).toBe('#,##0.00');
    expect(columnCode(column('number', { decimals: 0 }), EN_US)).toBe('#,##0');
    expect(columnCode(column('currency'), EN_US)).toBe('[$$-409]#,##0.00');
    expect(columnCode(column('currency', { currency: 'EUR' }), DE_DE)).toBe('#,##0.00"\u00a0"[$€-407]');
    expect(columnCode(column('percent', { decimals: 0 }), EN_US)).toBe('0%');
    expect(columnCode(column('percent', { decimals: 2 }), EN_US)).toBe('0.00%');
    expect(columnCode(column('date'), EN_US, 45292)).toBe('mmm d, yyyy');
    expect(columnCode(column('date'), DE_DE, 45292)).toBe('dd.mm.yyyy');
    expect(columnCode(column('number', { unit: 'kN' }), EN_US)).toBeNull();
    expect(columnCode(column('number', { notation: 'engineering' }), EN_US)).toBeNull();
    expect(columnCode(column('text'), EN_US)).toBeNull();
  });

  it('keeps the shown digits of columns without set decimals', () => {
    expect(columnCode(column('number'), EN_US, 1234.5)).toBe('#,##0.0');
    expect(columnCode(column('number'), EN_US, 0.1 + 0.2)).toBe('#,##0.0');
    expect(columnCode(column('percent'), EN_US, 0.256)).toBe('0.0%');
    expect(columnCode(column('percent'), EN_US, 0.25)).toBe('0%');
  });

  it('passes the format expectations of model.test.ts', () => {
    expect(formatValue(1234.5, column('number'), EN_US)).toBe('1,234.5');
    expect(formatValue(1234.5, column('number'), DE_DE)).toBe('1.234,5');
    expect(formatValue(1234.5, column('currency', { currency: 'EUR' }), DE_DE)).toMatch(/^1\.234,50\s€$/);
    expect(formatValue(1234.5, column('currency'), EN_US)).toBe('$1,234.50');
    expect(formatValue(0.256, column('percent'), EN_US)).toBe('25.6%');
    expect(formatValue(0.256, column('percent', { decimals: 0 }), EN_US)).toBe('26%');
    expect(formatValue(3.14159, column('number', { decimals: 2 }), EN_US)).toBe('3.14');
    expect(formatValue(46295, column('date'), EN_US)).toBe('Sep 30, 2026');
    expect(formatValue(46327, column('date'), EN_US)).toBe('Nov 1, 2026');
    expect(formatValue(4, column('currency'), EN_US)).toBe('$4.00');
  });

  // The text Intl wrote for these columns before they mapped to codes (format.ts on origin/beta).
  function before(value: number, col: Column, locale: Locale): string {
    const fixed: Intl.NumberFormatOptions =
      col.decimals === undefined
        ? { maximumFractionDigits: 10 }
        : { minimumFractionDigits: col.decimals, maximumFractionDigits: col.decimals };
    switch (col.type) {
      case 'currency':
        return new Intl.NumberFormat(locale.tag, {
          style: 'currency',
          currency: col.currency ?? locale.currency,
          ...(col.decimals === undefined ? {} : fixed),
        }).format(value);
      case 'percent':
        return new Intl.NumberFormat(locale.tag, {
          style: 'percent',
          ...(col.decimals === undefined ? { maximumFractionDigits: 2 } : fixed),
        }).format(value);
      case 'date': {
        const withTime = value !== Math.floor(value);
        return new Intl.DateTimeFormat(locale.tag, {
          dateStyle: 'medium',
          ...(withTime ? { timeStyle: 'short' } : {}),
          timeZone: 'UTC',
        }).format(new Date(Math.round((value - 25_569) * 86_400_000)));
      }
      default:
        return new Intl.NumberFormat(locale.tag, fixed).format(value);
    }
  }

  const numbers = [0, 1, -1, 12, 0.5, 0.001, 99.99, 1234.5, -1234.5, 3.14159, 1234567.891];
  const fractions = [0, 0.01, 0.256, 0.5, 1, -0.05, 2.5, 9.99];
  const dates = [45292, 46295, 46327, 36526, 45292.75, 46327.5];
  const cases: [string, Column, number[]][] = [
    ['number', column('number'), numbers],
    ['number, 0 decimals', column('number', { decimals: 0 }), numbers],
    ['number, 2 decimals', column('number', { decimals: 2 }), numbers],
    ['currency', column('currency'), numbers],
    ['currency EUR', column('currency', { currency: 'EUR' }), numbers],
    ['currency JPY', column('currency', { currency: 'JPY' }), numbers],
    ['currency, 0 decimals', column('currency', { decimals: 0 }), numbers],
    ['percent', column('percent'), fractions],
    ['percent, 1 decimal', column('percent', { decimals: 1 }), fractions],
    ['date', column('date'), dates],
  ];
  for (const locale of [EN_US, DE_DE, FR_FR])
    it.each(cases)(`shows %s in ${locale.tag} as before`, (_name, col, values) => {
      for (const value of values)
        expect(formatValue(value, col, locale), String(value)).toBe(before(value, col, locale));
    });
});

describe('cell codes', () => {
  it('lets a cell code win over the column type', () => {
    expect(formatValue(1234.5, column('number', { decimals: 2 }), EN_US, '0.0')).toBe('1234.5');
    expect(formatValue(1234.5, column('currency'), EN_US, '0')).toBe('1235');
    expect(formatValue(45292, column('number'), EN_US, 'yyyy-mm-dd')).toBe('2024-01-01');
    const negative = renderValue(-5, column('number'), EN_US, { fmt: '0;[Color3]-0' });
    expect(negative).toMatchObject({ text: '-5', color: 'color3' });
  });

  it('keeps units and engineering notation on unit columns', () => {
    expect(formatValue(12.5, column('number', { unit: 'kN' }), EN_US, '0.000')).toBe('12.5 kN');
    expect(formatValue(12500, column('number', { notation: 'engineering' }), EN_US, '0')).toBe(
      formatValue(12500, column('number', { notation: 'engineering' }), EN_US),
    );
  });

  it('formats text only through a text section', () => {
    expect(formatValue('abc', column('text'), EN_US, '"Item "@')).toBe('Item abc');
    expect(formatValue('abc', column('text'), EN_US, '0.00')).toBe('abc');
    expect(formatValue('abc', column('text'), EN_US)).toBe('abc');
  });

  it('shows errors, blanks, and booleans as before', () => {
    expect(formatValue(null, column('number'), EN_US, '0.00')).toBe('');
    expect(formatValue(true, column('checkbox'), EN_US, '0')).toBe('[x]');
    expect(formatValue(false, column('number'), EN_US, '0')).toBe('FALSE');
    expect(formatValue(Infinity, column('number'), EN_US, '0')).not.toBe('');
  });

  it('shows a row of # when a number does not fit', () => {
    expect(renderValue(123456789, column('number', { decimals: 0 }), EN_US, { maxChars: 5 })).toMatchObject({
      text: '#####',
      overflow: true,
    });
  });
});
