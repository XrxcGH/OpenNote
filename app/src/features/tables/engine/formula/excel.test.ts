import { describe, expect, it } from 'vitest';
import golden from '../../fixtures/translate.json';
import { columnLetters, fromExcel, sheetPrefix, toExcel, type TableRef } from './excel';

interface Case {
  name: string;
  book: string;
  row: number | null;
  direction: 'both' | 'toExcel' | 'fromExcel';
  opennote: string;
  excel: string;
}

const books = golden.books as Record<string, TableRef[]>;
const cases = golden.cases as Case[];

describe('formula translation with Excel (shared golden file)', () => {
  it('has the cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  for (const c of cases) {
    it(c.name, () => {
      const cx = { book: books[c.book], own: 0, row: c.row };
      if (c.direction !== 'fromExcel') expect(toExcel(c.opennote, cx)).toBe(c.excel);
      if (c.direction !== 'toExcel') expect(fromExcel(c.excel, cx)).toBe(c.opennote);
    });
  }

  it('quotes sheet names that need it and counts columns to XFD', () => {
    expect(sheetPrefix('Prices')).toBe('Prices!');
    expect(sheetPrefix("Bob's")).toBe("'Bob''s'!");
    expect(sheetPrefix('A1')).toBe("'A1'!");
    expect(columnLetters(16_383)).toBe('XFD');
  });
});
