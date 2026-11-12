// checks-disable-file brand-consistency: the test data holds color values to check how they are written
// Tests for the table export in Markdown. Expected values are written by hand from GFM tables and the format spec
// (R-SHT-12 for merges, R-SHT-17 for cached results), not taken from the code's output.
import { describe, expect, it } from 'vitest';
import { sheetModel } from '../../tables';
import { readExportPage, type ExportPage } from './source';
import { exportMarkdown } from './toMarkdown';

const cell = (markdown: string) => ({ markdown });

function page(sheet: Record<string, unknown>, stale = false): ExportPage {
  const columns = ['k1', 'k2', 'k3'].map((id) => ({ id, width: 100 }));
  const rows = [
    { id: 'r1', cells: { k1: cell('A'), k2: cell('B'), k3: cell('C') } },
    { id: 'r2', cells: { k1: cell('x'), k2: cell('=2*3'), k3: cell('') } },
    { id: 'r3', cells: { k1: cell('y'), k2: cell(''), k3: cell('') } },
  ];
  const valuesOf = stale ? 'fnv1a:0000000000000000' : sheetModel.fingerprint({ header: true, columns, rows });
  return readExportPage({
    id: 'P',
    title: 'T',
    blocks: [
      {
        id: 'tb',
        order: 'a',
        type: 'table',
        data: { header: true, columns, rows, sheet: { values: { r2: { k2: 6 } }, valuesOf, ...sheet } },
      },
    ],
  });
}

const md = (p: ExportPage, onStaleTable?: (id: string) => void) =>
  exportMarkdown(p, { frontMatter: 'none', onStaleTable }).markdown;

describe('table Markdown with a sheet', () => {
  it('writes the cached result of a formula cell', () => {
    expect(md(page({}))).toBe('# T\n\n| A | B | C |\n| --- | --- | --- |\n| x | 6 |  |\n| y |  |  |\n');
  });

  it('writes the formula and names the table when the results are stale', () => {
    const stale: string[] = [];
    expect(md(page({}, true), (id) => stale.push(id))).toContain('| x | =2*3 |  |');
    expect(stale).toEqual(['tb']);
  });

  it('leaves the cells a merge covers empty', () => {
    const text = md(page({ merges: { m1: { from: ['r2', 'k2'], to: ['r3', 'k3'] } } }));
    expect(text).toContain('| x | 6 |  |\n| y |  |  |');
  });

  it('writes bold, italic, and strike of a cell style, and nothing else', () => {
    const styles = {
      s1: { font: { bold: true, italic: true, strike: 'single', size: 20, color: '#aa0000' }, fill: '#ffeecc' },
    };
    const text = md(page({ styles, cells: { r2: { k1: 's1' } } }));
    expect(text).toContain('| ***~~x~~*** | 6 |  |');
  });
});
