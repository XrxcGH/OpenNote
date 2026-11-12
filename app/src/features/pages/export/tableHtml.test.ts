// checks-disable-file brand-consistency: the test data holds color values to check how they are written
// Tests for the table export: formula results, merges, and cell looks in HTML. Expected values are worked out by
// hand from the format spec (R-SHT-5, R-SHT-12, R-SHT-17, R-SHT-18) and from HTML and CSS, not from the code's output.
import { describe, expect, it } from 'vitest';
import { sheetModel } from '../../tables';
import { readExportPage, type ExportPage } from './source';
import { cellCss } from './tableHtml';
import { exportHtml } from './toHtml';

const cols = ['k1', 'k2', 'k3'];
const cell = (markdown: string) => ({ markdown });

/** A 3 by 3 table: a header and two rows. B2 holds the formula, so its cached result is 6. */
function page(sheet: Record<string, unknown>, stale = false): ExportPage {
  const rows = [
    { id: 'r1', cells: { k1: cell('A'), k2: cell('B'), k3: cell('C') } },
    { id: 'r2', cells: { k1: cell('x'), k2: cell('=2*3'), k3: cell('') } },
    { id: 'r3', cells: { k1: cell('y'), k2: cell(''), k3: cell('') } },
  ];
  const data = {
    header: true,
    columns: cols.map((id) => ({ id, width: 100 })),
    rows,
  };
  const like = { header: true, columns: data.columns, rows, smart: undefined };
  const valuesOf = stale ? 'fnv1a:0000000000000000' : sheetModel.fingerprint(like);
  return readExportPage({
    id: 'P',
    title: 'T',
    blocks: [
      {
        id: 'tb',
        order: 'a',
        type: 'table',
        data: { ...data, sheet: { values: { r2: { k2: 6 } }, valuesOf, ...sheet } },
      },
    ],
  });
}

describe('table HTML with a sheet', () => {
  it('writes the cached result of a formula cell when it is fresh', () => {
    const html = exportHtml(page({})).html;
    expect(html).toContain('<td>6</td>');
    expect(html).not.toContain('=2*3');
  });

  it('writes the formula text and names the table when the fingerprint is stale', () => {
    const stale: string[] = [];
    const html = exportHtml(page({}, true), { onStaleTable: (id) => stale.push(id) }).html;
    expect(html).toContain('<td>=2*3</td>');
    expect(stale).toEqual(['tb']);
  });

  it('writes colspan and rowspan on the anchor of a merge and leaves out the covered cells', () => {
    // B2:C3 is rows r2 to r3 and columns k2 to k3.
    const html = exportHtml(page({ merges: { m1: { from: ['r2', 'k2'], to: ['r3', 'k3'] } } })).html;
    expect(html).toContain('<td colspan="2" rowspan="2">6</td>');
    // Row 2 has A-column cell and the anchor only; row 3 has its A-column cell only.
    expect(html).toContain('<tr><td>x</td><td colspan="2" rowspan="2">6</td></tr>');
    expect(html).toContain('<tr><td>y</td></tr>');
  });

  it('writes a fill, a double bottom border, vertical center, and padding as CSS', () => {
    const styles = {
      s1: {
        fill: '#ffeecc',
        border: { b: { style: 'double', color: '#112233' } },
        align: { v: 'middle', h: 'center' },
        pad: { t: 3, r: 5, b: 3, l: 5 },
      },
    };
    const html = exportHtml(page({ styles, cells: { r2: { k1: 's1' } } })).html;
    expect(html).toContain('background-color:#ffeecc');
    expect(html).toContain('border-bottom:3px double #112233');
    expect(html).toContain('vertical-align:middle');
    expect(html).toContain('text-align:center');
    expect(html).toContain('padding:3pt 5pt 3pt 5pt');
  });

  it('writes bold, italic, strike, and a font size of a style', () => {
    const styles = { s1: { font: { bold: true, italic: true, strike: 'single', size: 14 } } };
    const html = exportHtml(page({ styles, cells: { r2: { k1: 's1' } } })).html;
    expect(html).toContain('font-size:14pt');
    expect(html).toContain('font-weight:700');
    expect(html).toContain('font-style:italic');
    expect(html).toContain('text-decoration:line-through');
  });

  it('keeps a table without a sheet as plain as before', () => {
    const plain = readExportPage({
      id: 'P',
      title: 'T',
      blocks: [
        {
          id: 'tb',
          order: 'a',
          type: 'table',
          data: { header: false, columns: [{ id: 'k1', width: 100 }], rows: [{ id: 'r1', cells: { k1: cell('a') } }] },
        },
      ],
    });
    expect(exportHtml(plain).html).toContain('<tbody>\n<tr><td>a</td></tr>\n</tbody>');
  });
});

describe('table HTML edge cases', () => {
  it('does not flag a table without a sheet, as the Rust reader does not', () => {
    const plain = readExportPage({
      id: 'P',
      title: 'T',
      blocks: [
        {
          id: 'tb',
          order: 'a',
          type: 'table',
          data: {
            header: false,
            columns: [{ id: 'k1', width: 100 }],
            rows: [{ id: 'r1', cells: { k1: cell('=1+1') } }],
          },
        },
      ],
    });
    const stale: string[] = [];
    const html = exportHtml(plain, { onStaleTable: (id) => stale.push(id) }).html;
    expect(html).toContain('<td>=1+1</td>');
    expect(stale).toEqual([]);
  });

  it('keeps the formula text for a cached entry that is not a valid value', () => {
    // R-SHT-17: an array, or an object that is not a lone error code, is ignored. The Rust reader does the same.
    const a = page({ values: { r2: { k2: [1, 2] } } });
    expect(exportHtml(a).html).toContain('<td>=2*3</td>');
    const b = page({ values: { r2: { k2: { e: '#N/A', x: 1 } } } });
    expect(exportHtml(b).html).toContain('<td>=2*3</td>');
  });

  it('keeps only names and separators in a font family', () => {
    const css = cellCss({ font: { family: 'Segoe UI, \\22 x url(//e.example/a) {};<b>' } } as never);
    expect(css).toBe('font-family:Segoe UI, 22 x urle.examplea b');
  });
});
