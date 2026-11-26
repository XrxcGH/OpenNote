import { describe, expect, it } from 'vitest';
import { isName, sheetProblems } from './schema';
import { specCases } from './testing';

describe('the grammar of data.sheet (spec 6.3)', () => {
  const cases = specCases();

  it('reads every spec case', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
  });

  it.each(cases.map((c) => [c.file, c] as const))('finds exactly the problems %s lists', (_file, c) => {
    const found = c.data.sheet === undefined ? [] : sheetProblems(c.data.sheet as never, 'blocks[0].data.sheet');
    expect([...found].sort()).toEqual([...(c.problems ?? [])].sort());
  });

  it('knows the names of R-SHT-13', () => {
    for (const name of ['TaxRate', '_x', '\\path', 'Prices.2026', 'ABCD1', 'Été', 'R1C1x'])
      expect(isName(name)).toBe(true);
    for (const name of ['1st', 'A1', 'xfd1048576', 'R', 'c', 'R12', 'C7', 'r1c1', 'a b', '', 'x'.repeat(256)]) {
      expect(isName(name)).toBe(false);
    }
  });
});
