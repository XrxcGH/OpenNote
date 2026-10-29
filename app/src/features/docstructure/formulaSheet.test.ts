import { describe, expect, it } from 'vitest';
import { buildSheet, chooseColumns, collectFormulas, ROWS_PER_COLUMN } from './formulaSheet';

const pages = [
  {
    title: 'Kinematics',
    texts: ['## Position\n\n$$\ny = y_0 + v_0 t + \\tfrac12 a t^2 \\label{eq-1}\n$$\n\nText.', '$$\nv = v_0 + a t\n$$'],
  },
  { title: 'Energy', texts: ['$$\nE_k = \\tfrac12 m v^2\n$$\n\n$$\nv = v_0 +  a t\n$$'] },
];

describe('collecting formulas', () => {
  it('finds display equations with their topics and drops repeats and labels', () => {
    const found = collectFormulas(pages);
    expect(found.map((f) => f.latex)).toEqual([
      'y = y_0 + v_0 t + \\tfrac12 a t^2',
      'v = v_0 + a t',
      'E_k = \\tfrac12 m v^2',
    ]);
    expect(found.map((f) => f.topic)).toEqual(['Position', 'Position', 'Energy']);
  });

  it('ignores inline math and unclosed fences', () => {
    expect(collectFormulas([{ title: 'T', texts: ['Use $x^2$ here.', '$$\nnever closed'] }])).toEqual([]);
  });
});

describe('laying out the sheet', () => {
  it('uses the fewest columns that fit and reports overflow', () => {
    expect(chooseColumns(ROWS_PER_COLUMN)).toEqual({ columns: 1, overflow: 0 });
    expect(chooseColumns(ROWS_PER_COLUMN + 1)).toEqual({ columns: 2, overflow: 0 });
    expect(chooseColumns(10, 3)).toEqual({ columns: 3, overflow: 0 });
    expect(chooseColumns(4 * ROWS_PER_COLUMN + 5)).toEqual({ columns: 4, overflow: 5 });
  });

  it('fills the cells down each column', () => {
    const many = Array.from({ length: 20 }, (_v, i) => ({ latex: `a_{${i}}`, topic: '' }));
    const sheet = buildSheet(many);
    expect(sheet.columns).toBe(2);
    expect(sheet.rows).toHaveLength(10);
    expect(sheet.rows[0]).toEqual(['$a_{0}$', '$a_{10}$']);
    expect(sheet.rows[9]).toEqual(['$a_{9}$', '$a_{19}$']);
    expect(sheet.count).toBe(20);
  });

  it('names a topic once above its first formula', () => {
    const sheet = buildSheet(collectFormulas(pages));
    const cells = sheet.rows.flat().join(' ');
    expect(cells).toContain('*Position* $y = y_0');
    expect(cells.match(/\*Position\*/g)).toHaveLength(1);
  });

  it('leaves empty cells at the end of the last column and drops formulas that do not fit', () => {
    const sheet = buildSheet(Array.from({ length: 70 }, (_v, i) => ({ latex: `f_{${i}}`, topic: '' })));
    expect(sheet.columns).toBe(4);
    expect(sheet.count).toBe(64);
    expect(sheet.overflow).toBe(6);
  });
});
