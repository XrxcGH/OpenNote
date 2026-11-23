// @vitest-environment jsdom
// checks-disable-file brand-consistency: colors and sizes here are clipboard CSS for other apps or test inputs, not design values.
import { describe, expect, it } from 'vitest';
import { daysToIso } from './dates';
import { DE_DE, EN_US, FR_FR, type Locale } from './locale';
import {
  MAX_COLUMNS,
  MAX_ROWS,
  parseDelimited,
  parseHtmlTable,
  sniffDelimiter,
  tableFromClipboard,
  tableFromText,
} from './paste';
import type { PasteResult } from './paste';
import { CALC_TABLE, EXCEL_DE, EXCEL_EN, EXCEL_STYLED, sheetsFormulaTable, sheetsTable } from './paste.fixtures';
import { readClip, readOwn } from './paste/clip';
import { cssBorder, cssColor, msoCode } from './paste/css';
import { a1ToR1C1, r1c1ToA1 } from './paste/formula';
import type { Value } from './values';

const NARROW = String.fromCharCode(0x202f);

/** Pastes text, falling back to one column per line for single-column inputs that the sniffer rightly ignores. */
function text(input: string, locale: Locale = EN_US): PasteResult {
  const result = tableFromText(input, locale) ?? tableFromText(input, locale, '\t');
  if (!result) throw new Error('not a table');
  return result;
}

const types = (r: PasteResult): string[] => r.table.columns.map((c) => c.type);
const names = (r: PasteResult): string[] => r.table.columns.map((c) => c.name);
const values = (r: PasteResult): Value[][] => r.table.rows.map((row) => row.cells.map((c) => c.value));
/** The serial of an ISO date: days since 1899-12-30, which is 25569 days before 1970-01-01. */
const day = (iso: string): number =>
  Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000 + 25_569;

describe('delimited text', () => {
  it('reads RFC 4180 quoting', () => {
    const csv = 'a,"b,1","say ""hi""","line\nbreak"\r\n1,2,3,4\r\n';
    expect(parseDelimited(csv, ',')).toEqual([
      ['a', 'b,1', 'say "hi"', 'line\nbreak'],
      ['1', '2', '3', '4'],
    ]);
  });

  it('handles every line ending, empty fields, blank lines, and a byte order mark', () => {
    expect(parseDelimited('\ufeffa,,c\r1,2,3\n\n4,,', ',')).toEqual([
      ['a', '', 'c'],
      ['1', '2', '3'],
      ['4', '', ''],
    ]);
    expect(parseDelimited('a\t"b\tc"', '\t')).toEqual([['a', 'b\tc']]);
    expect(parseDelimited('x"y,z', ',')).toEqual([['x"y', 'z']]);
    expect(parseDelimited('a,b\nc,d\ne,f', ',', 2)).toHaveLength(2);
  });

  it.each([
    ['a\tb\nc\td', '\t'],
    ['a\tb', '\t'],
    ['a;b;c\n1;2;3', ';'],
    ['a,b\n1,2\n3,4', ','],
    ['a|b\n1|2', '|'],
    ['"a,b";c\n"1,2";3', ';'],
    ['a,b\n1,2,3\n4,5\n6,7\n8,9\n1,2\n3,4\n5,6\n7,8\n9,0\n1,1', ','],
  ])('sniffs %j as %j', (input, delimiter) => {
    expect(sniffDelimiter(input)).toBe(delimiter);
  });

  it.each(['Hello, world', 'one column\nof text\nonly', 'a,b\n1\n2\n3', '', 'plain'])(
    'does not read %j as a table',
    (input) => {
      expect(sniffDelimiter(input)).toBeNull();
      expect(tableFromText(input, EN_US)).toBeNull();
    },
  );
});

describe('type inference by region', () => {
  it('types columns and finds a header above typed data', () => {
    const r = text(
      'Item,Qty,Price,Share,Due,Done\nSeed trays,12,$12.50,25%,2026-09-30,yes\nSoil,3,"$1,200.00",50%,2026-10-01,no\n',
    );
    expect(r.header).toBe(true);
    expect(names(r)).toEqual(['Item', 'Qty', 'Price', 'Share', 'Due', 'Done']);
    expect(types(r)).toEqual(['text', 'number', 'currency', 'percent', 'date', 'checkbox']);
    expect(r.table.columns[2]).toMatchObject({ currency: 'USD', decimals: 2 });
    expect(values(r)[1]).toEqual(['Soil', 3, 1200, 0.5, day('2026-10-01'), false]);
    expect(r.table.rows[0].cells[2].raw).toBe('$12.50');
  });

  it('votes on the decimal mark, with ties going to the region', () => {
    expect(values(text('n\n1234.56\n7.5\n', DE_DE))).toEqual([[1234.56], [7.5]]);
    expect(values(text('n\n1.234,56\n7,5\n', EN_US))).toEqual([[1234.56], [7.5]]);
    expect(values(text('n\n1.234\n', DE_DE))).toEqual([[1234]]);
    expect(values(text('n\n1.234\n', EN_US))).toEqual([[1.234]]);
    expect(types(text('n\n1.234\n', DE_DE))).toEqual(['number']);
  });

  it('reads the French format with its narrow and no-break spaces', () => {
    const r = text(`Prix\n1${NARROW}234,50\n12,5\n`, FR_FR);
    expect(values(r)).toEqual([[1234.5], [12.5]]);
    expect(values(text(`Prix\n1${String.fromCharCode(0xa0)}234,50\n`, FR_FR))).toEqual([[1234.5]]);
  });

  it('reads dates in the region order, and switches order when a value contradicts it', () => {
    expect(values(text('d\n01/02/2026\n', EN_US))[0][0]).toBe(day('2026-01-02'));
    expect(values(text('d\n01/02/2026\n', DE_DE))[0][0]).toBe(day('2026-02-01'));
    const r = text('d\n13/01/2026\n14/02/2026\n', EN_US);
    expect(types(r)).toEqual(['date']);
    expect(values(r)).toEqual([[day('2026-01-13')], [day('2026-02-14')]]);
    expect(values(text('d\nSep 30, 2026\n1 Oct 2026\n', DE_DE))).toEqual([[day('2026-09-30')], [day('2026-10-01')]]);
  });

  it('types a column when 90% of its values fit, and leaves the rest as text', () => {
    const rows = Array.from({ length: 9 }, (_, i) => String(i + 1)).concat('n/a');
    const r = text(`n\n${rows.join('\n')}\n`);
    expect(types(r)).toEqual(['number']);
    expect(values(r)[9]).toEqual(['n/a']);
    expect(types(text('n\n1\n2\n3\n4\n5\n6\n7\n8\nx\ny\n'))).toEqual(['text']);
  });
});

describe('currency, signs, and the 90% rule', () => {
  it('reads currency in German format with the euro sign', () => {
    const r = text('Preis\n1.234,50 €\n12,00 €\n', DE_DE);
    expect(types(r)).toEqual(['currency']);
    expect(r.table.columns[0]).toMatchObject({ currency: 'EUR', decimals: 2 });
    expect(values(r)).toEqual([[1234.5], [12]]);
  });

  it('keeps negatives in parentheses and with signs', () => {
    expect(values(text('n\n(12.5)\n-3\n+4\n'))).toEqual([[-12.5], [-3], [4]]);
  });
});

describe('headers, names, and limits', () => {
  it('uses letters when the first row is data, and when names are blank or repeat', () => {
    const noHeader = text('1,2\n3,4\n');
    expect(noHeader.header).toBe(false);
    expect(names(noHeader)).toEqual(['A', 'B']);
    expect(noHeader.table.rows).toHaveLength(2);
    expect(text('a,b\nc,d\n').header).toBe(false);
    const html = '<table><tr><th>Name</th><th>Name</th><th></th></tr><tr><td>x</td><td>y</td><td>1</td></tr></table>';
    expect(names(tableFromClipboard({ html }, EN_US) as PasteResult)).toEqual(['Name', 'Name 2', 'C']);
  });

  it('never creates formulas from pasted text', () => {
    const r = text('a,b\n"=SUM(1,2)",x\n=1+1,y\n');
    expect(values(r)[1][0]).toBe('=SUM(1,2)');
    expect(values(r)[2][0]).toBe('=1+1');
    expect(r.table.rows.every((row) => row.cells.every((c) => c.formula === undefined))).toBe(true);
  });

  it('keeps the first 10,000 rows and 100 columns', () => {
    const rows = ['n'].concat(Array.from({ length: MAX_ROWS + 50 }, (_, i) => String(i)));
    const tall = tableFromText(rows.join('\n') + '\n', EN_US, ',');
    expect(tall?.table.rows).toHaveLength(MAX_ROWS);
    expect(tall?.droppedRows).toBe(50);
    const wide = text(
      Array.from({ length: MAX_COLUMNS + 20 }, (_, i) => `c${i}`).join(',') +
        '\n' +
        '1,'.repeat(MAX_COLUMNS + 19) +
        '1',
    );
    expect(wide.table.columns).toHaveLength(MAX_COLUMNS);
    expect(wide.droppedColumns).toBe(20);
  });
});

describe('Excel HTML', () => {
  const result = tableFromClipboard({ html: EXCEL_EN, text: 'ignored' }, EN_US) as PasteResult;

  it('reads the raw numbers, types, and formats from the style block', () => {
    expect(result.source).toBe('excel');
    expect(result.header).toBe(true);
    expect(names(result)).toEqual(['Item', 'Qty', 'Price', 'Share', 'Due', 'Done', 'Total']);
    expect(types(result)).toEqual(['text', 'number', 'currency', 'percent', 'date', 'checkbox', 'number']);
    expect(values(result)[0]).toEqual(['Seed trays', 12, 12.5, 0.255, day('2024-09-30'), true, 150]);
    expect(values(result)[1][0]).toBe('Potting\nsoil');
    expect(result.table.rows[0].cells[3].raw).toBe('26%');
    expect(daysToIso(values(result)[1][4] as number)).toBe('2024-10-01');
  });

  it('skips hidden rows, and reports that formulas became values', () => {
    expect(result.table.rows).toHaveLength(2);
    expect(result.formulasDropped).toBe(true);
    expect(result.table.rows.every((row) => row.cells.every((c) => c.formula === undefined))).toBe(true);
  });

  it('reads a German Excel table with its regional text and euro format', () => {
    const r = tableFromClipboard({ html: EXCEL_DE }, DE_DE) as PasteResult;
    expect(types(r)).toEqual(['text', 'currency', 'number']);
    expect(r.table.columns[1]).toMatchObject({ currency: 'EUR', decimals: 2 });
    expect(values(r)).toEqual([
      ['Erde', 1234.5, 1234.5],
      ['Samen', 3, 3],
    ]);
  });

  it('keeps merged cells in their first cell', () => {
    const html =
      '<table><tr><td colspan=2>A</td><td>B</td></tr><tr><td rowspan=2>1</td><td>2</td><td>3</td></tr>' +
      '<tr><td>4</td><td>5</td></tr></table>';
    const grid = parseHtmlTable(html);
    expect(grid?.rows.map((row) => row.map((c) => c.text))).toEqual([
      ['A', '', 'B'],
      ['1', '2', '3'],
      ['', '4', '5'],
    ]);
  });
});

describe('other spreadsheets', () => {
  it('reads Google Sheets values and formats', () => {
    const r = tableFromClipboard({ html: sheetsTable() }, EN_US) as PasteResult;
    expect(r.source).toBe('sheets');
    expect(types(r)).toEqual(['percent', 'number']);
    expect(values(r)).toEqual([
      [0.5, 4],
      [0.25, 6],
    ]);
  });

  it('reads LibreOffice values and date formats', () => {
    const r = tableFromClipboard({ html: CALC_TABLE }, EN_US) as PasteResult;
    expect(r.source).toBe('calc');
    expect(types(r)).toEqual(['date', 'number']);
    expect(values(r)[0]).toEqual([day('2024-09-30'), 12.5]);
  });
});

describe('ordinary web tables and the clipboard choice', () => {
  const tsv = 'a\tb\n1\t2';
  const one = '<table><tr><td>1</td></tr></table>';

  it('reads markup and entities as plain text', () => {
    const html =
      '<table><thead><tr><th>Name</th><th>Note</th></tr></thead>' +
      '<tr><td><b>A &amp; B</b></td><td>x &lt;script&gt; <i>y</i></td></tr></table>';
    const r = tableFromClipboard({ html }, EN_US) as PasteResult;
    expect(r.source).toBe('html');
    expect(r.header).toBe(true);
    expect(values(r)).toEqual([['A & B', 'x <script> y']]);
  });

  it('uses the text when the HTML has no table, several, or words around one', () => {
    expect(tableFromClipboard({ html: '<p>hello</p>', text: tsv }, EN_US)?.source).toBe('delimited');
    expect(tableFromClipboard({ html: one + one, text: tsv }, EN_US)?.source).toBe('delimited');
    expect(tableFromClipboard({ html: `<p>Intro</p>${one}`, text: tsv }, EN_US)?.source).toBe('delimited');
  });

  it('reads hostile cells as text and finds words hidden around the table', () => {
    const cells =
      '<table><tr><td><scr<script>ipt>alert(1)</script></td><td>a<!-- <b>no</b> -->b</td>' +
      '<td>C:\\Notes\\x</td></tr></table>';
    expect(values(tableFromClipboard({ html: cells }, EN_US) as PasteResult)).toEqual([
      ['ipt>alert(1)', 'ab', 'C:\\Notes\\x'],
    ]);
    // Comments, scripts, and head content around a table are not words; a tag split to slip past a pattern is.
    const head = '<html><head><title>t</title><style>td{}</style></head>';
    const quiet = `${head}<body><!--StartFragment-->${one}<!-- <p>x</p> --><script>y</script></body></html>`;
    expect(tableFromClipboard({ html: quiet }, EN_US)?.source).toBe('html');
    for (const around of ['<scr<script>ipt>words</script>', '<!<!-- -->-- words -->', '<<p>p>words'])
      expect(tableFromClipboard({ html: around + one, text: tsv }, EN_US)?.source, around).toBe('delimited');
  });

  it('returns nothing when neither form is a table', () => {
    expect(tableFromClipboard({ html: `<p>Intro</p>${one}` }, EN_US)).toBeNull();
    expect(tableFromClipboard({}, EN_US)).toBeNull();
  });
});

describe('clipboard formulas in R1C1 form', () => {
  it('turns A1 references into steps from the cell, and back', () => {
    // From A4 (row 3, column 0): A2 is two rows up, $B$1 is absolute row 1, column 2.
    expect(a1ToR1C1('=SUM(A2:A3)+$B$1*B$2', { row: 3, col: 0 })).toBe('=SUM(R[-2]C[0]:R[-1]C[0])+R1C2*R2C[1]');
    expect(r1c1ToA1('=SUM(R[-2]C[0]:R[-1]C[0])+R1C2*R2C[1]', { row: 3, col: 0 })).toBe('=SUM(A2:A3)+$B$1*B$2');
  });

  it('takes a header row off absolute rows only', () => {
    expect(r1c1ToA1('=R[-1]C+R3C1', { row: 2, col: 1 }, 1)).toBe('=B2+$A$2');
  });

  it('leaves text, quoted sheet names, column names, and functions alone', () => {
    expect(a1ToR1C1('=LOG10(A1)&"B2"&[Qty]&\'A1\'!A1', { row: 0, col: 0 })).toBe(
      '=LOG10(R[0]C[0])&"B2"&[Qty]&\'A1\'!R[0]C[0]',
    );
    expect(r1c1ToA1('=_xlfn.CONCAT("R[1]C",RC)', { row: 0, col: 0 })).toBe('=CONCAT("R[1]C",A1)');
  });

  it('gives #REF! for a reference above the first row', () => {
    expect(r1c1ToA1('=R[-2]C[0]', { row: 0, col: 0 })).toBe('=#REF!');
  });

  it('gives #REF! for a reference past the last row or column (1,048,576 rows, 16,384 columns)', () => {
    expect(r1c1ToA1('=R[99999999]C[0]', { row: 0, col: 0 })).toBe('=#REF!');
    expect(r1c1ToA1('=RC[20000]', { row: 0, col: 0 })).toBe('=#REF!');
    expect(r1c1ToA1('=R1048577C1', { row: 0, col: 0 })).toBe('=#REF!');
    // The last cell itself is XFD1048576.
    expect(r1c1ToA1('=R1048576C16384', { row: 0, col: 0 })).toBe('=$XFD$1048576');
  });
});

describe('clipboard styles', () => {
  it('reads CSS colors, borders, and Excel number formats', () => {
    expect(cssColor('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(cssColor('#0F0')).toBe('#00ff00');
    expect(cssColor('windowtext')).toBeNull();
    expect(cssBorder('.5pt solid windowtext')).toEqual({ style: 'thin' });
    expect(cssBorder('2px solid #cc0000')).toEqual({ style: 'medium', color: '#cc0000' });
    expect(cssBorder('2.0pt double black')).toEqual({ style: 'double' });
    expect(msoCode(String.raw`"\0022$\0022\#\,\#\#0\.00"`)).toBe('"$"#,##0.00');
    expect(msoCode('Percent')).toBe('0.00%');
    expect(msoCode('General')).toBeNull();
  });

  it('reads an Excel copy as cells with styles, values, R1C1 formulas, and widths', () => {
    const clip = readClip({ html: EXCEL_STYLED });
    expect(clip?.source).toBe('excel');
    expect(clip?.widths).toEqual([64]);
    expect(clip?.rows.map((row) => row[0].style)).toEqual([
      { font: { bold: true, color: '#ff0000' } },
      { fmt: '#,##0.00' },
      { fmt: '#,##0.00' },
      { fmt: '#,##0.00' },
    ]);
    expect(clip?.rows[3][0]).toMatchObject({ num: 1244.5, formula: '=SUM(R[-2]C[0]:R[-1]C[0])' });
  });

  it('reads Sheets formulas as written and drops the body font every cell shares', () => {
    const clip = readClip({ html: sheetsFormulaTable() });
    expect(clip?.rows[2][0]).toEqual({ text: '5', num: 5, formula: '=R[-2]C[0]+R[-1]C[0]' });
  });

  it('reads LibreOffice format codes from sdnum and spans as merges', () => {
    const clip = readClip({ html: CALC_TABLE });
    expect(clip?.rows[1][1].style).toEqual({ fmt: '0.00' });
    const merged = readClip({
      html: '<table><tr><td colspan=2 rowspan=2>a</td><td>b</td></tr><tr><td>c</td></tr></table>',
    });
    expect(merged?.spans).toEqual([{ row: 0, col: 0, rows: 2, cols: 2 }]);
    expect(merged?.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ['a', '', 'b'],
      ['', '', 'c'],
    ]);
  });

  it('reads tab-separated text, and leaves one value to the editor', () => {
    expect(readClip({ text: 'a\tb\r\nc\td\r\n' })?.rows.map((row) => row.map((c) => c.text))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(readClip({ text: 'one value' })).toBeNull();
  });

  it('ignores an own form it does not know, and invalid styles inside one', () => {
    expect(readOwn('{"v":2,"rows":[[{"m":"a"}]]}')).toBeNull();
    expect(readOwn('not json')).toBeNull();
    const form = {
      v: 1,
      header: false,
      top: 0,
      left: 0,
      rows: [[{ m: 'a', s: { fill: '<script>' } }]],
      spans: [{ row: 0, col: 0, rows: 9, cols: 9 }],
    };
    const clip = readOwn(JSON.stringify(form));
    expect(clip?.rows[0][0]).toEqual({ text: 'a', markdown: 'a' });
    expect(clip?.spans).toEqual([]);
  });
});
