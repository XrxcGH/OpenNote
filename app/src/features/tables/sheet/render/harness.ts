// checks-disable-file brand-consistency: cell colors here are document data of the file format, not interface styling

// A test harness for the browser tests (tests/ui/behavior/sheet-render.spec.ts and tests/ui/visual): it builds the
// HTML a table's decorations would give, from the same `drawTable`, and the CSS to draw it with. Node only.

import { readFileSync } from 'node:fs';
import { applyToRange, type Sheet, type StyleChange, type TableLike } from '../model';
import { K, R, makeTable, range } from '../model/testing';
import { drawTable, styleText } from './draw';
import type { Scheme } from './color';
import { measureTable } from './measure';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

/** The CSS of the page: layer order, tokens, the table's own rules, and the render rules. */
export function harnessCss(): string {
  return [
    read('../../../../styles/layers.css'),
    read('../../../../theme/tokens.css'),
    read('./render.css'),
    'body{margin:16px;font:14px/1.4 var(--font-reading,serif);color:var(--color-text-primary);background:var(--color-surface-page)}',
    'table{table-layout:fixed}p{margin:0}',
  ].join('\n');
}

/** The measuring pass as source text, to run inside the page. */
export const MEASURE_SOURCE = `(${measureTable.toString()})`;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface Harness {
  sheet: Sheet;
  table: TableLike;
  /** Column widths in px. */
  widths: number[];
}

/** The `<table>` a table's decorations give, with ID `id`. */
export function tableHtml(id: string, h: Harness, scheme: Scheme, hiddenRows?: ReadonlySet<string>): string {
  const drawn = drawTable({ sheet: h.sheet, table: h.table, scheme, hiddenRows });
  const attrs = (d: { vars: Record<string, string>; data: Record<string, string> }, extra = '') => {
    const style = styleText(d.vars);
    const data = Object.entries(d.data).map(([k, v]) => `${k}="${v}"`);
    return `${extra}${data.length ? ' ' + data.join(' ') : ''}${style ? ` style="${style}"` : ''}`;
  };
  const shown = h.widths.filter((_, c) => drawn.cells[0]?.[c]?.data['data-col-hidden'] === undefined);
  drawn.table.vars.width = `${shown.reduce((a, b) => a + b, 0)}px`;
  const cols = h.widths.map((w) => `<col style="width:${w}px">`).join('');
  const rows = h.table.rows
    .map((row, r) => {
      const cells = h.table.columns
        .map((col, c) => {
          const text = escapeHtml(row.cells[col.id]?.markdown ?? '');
          return `<td${attrs(drawn.cells[r][c], ' data-cell')}><p>${text}</p></td>`;
        })
        .join('');
      return `<tr${attrs(drawn.rows[r])}>${cells}</tr>`;
    })
    .join('');
  return `<table id="${id}"${attrs(drawn.table)}><colgroup>${cols}</colgroup><tbody>${rows}</tbody></table>`;
}

/** A sheet and table built cell by cell. */
export class Builder {
  sheet: Sheet = {};
  table: TableLike;
  widths: number[];

  constructor(rows: number, cols: number, width = 90) {
    this.table = makeTable(range(1, rows), range(1, cols));
    this.widths = Array.from({ length: cols }, () => width);
    // Cells start empty; the fixture sets the ones it uses.
    this.table = {
      ...this.table,
      rows: this.table.rows.map((row) => ({ ...row, cells: {} })),
    };
  }

  text(row: number, col: number, markdown: string): this {
    const rows = this.table.rows.map((r, i) =>
      i === row - 1 ? { ...r, cells: { ...r.cells, [K(col)]: { markdown } } } : r,
    );
    this.table = { ...this.table, rows };
    return this;
  }

  style(row: number, col: number, change: StyleChange): this {
    this.sheet = applyToRange(this.sheet, this.table, [R(row), K(col)], [R(row), K(col)], change).sheet;
    return this;
  }

  settings(table: Record<string, unknown>): this {
    this.sheet = { ...this.sheet, table: { ...(this.sheet.table as object), ...table } } as Sheet;
    return this;
  }

  rowSettings(row: number, settings: Record<string, unknown>): this {
    this.sheet = { ...this.sheet, rows: { ...(this.sheet.rows as object), [R(row)]: settings } } as Sheet;
    return this;
  }

  build(): Harness {
    return { sheet: this.sheet, table: this.table, widths: this.widths };
  }
}

export const BORDER_STYLES = [
  'hair',
  'thin',
  'medium',
  'thick',
  'dotted',
  'dashed',
  'mediumDashed',
  'dashDot',
  'mediumDashDot',
  'dashDotDot',
  'mediumDashDotDot',
  'slantDashDot',
  'double',
];

/** Thirteen cells, one per border style, with a blank cell between neighbors so each edge is its own. */
export function bordersFixture(): Harness {
  const b = new Builder(7, 7, 80);
  BORDER_STYLES.forEach((style, i) => {
    const row = 1 + 2 * Math.floor(i / 4);
    const col = 1 + 2 * (i % 4);
    const side = { style, color: '#1f2937' };
    b.text(row, col, style).style(row, col, {
      border: { t: side, r: side, b: side, l: side },
      align: { h: 'center', v: 'middle', wrap: 'clip' },
      font: { size: 8 },
    });
  });
  for (let r = 1; r <= 7; r += 2) b.rowSettings(r, { height: 30, exact: true });
  return b.build();
}

/** Alignment, wrap and overflow, rotation, shrink, fonts, fills, and merged-looking spans on one table. */
export function stylesFixture(): Harness {
  const b = new Builder(9, 6, 100);
  const long = 'A long sentence that does not fit';
  b.text(1, 1, 'left').style(1, 1, { align: { h: 'left' } });
  b.text(1, 2, 'center').style(1, 2, { align: { h: 'center' } });
  b.text(1, 3, 'right').style(1, 3, { align: { h: 'right' } });
  b.text(1, 4, '1,234.50');
  b.text(1, 5, 'TRUE');
  b.text(1, 6, 'indent').style(1, 6, { align: { indent: 2 } });
  b.rowSettings(2, { height: 60 });
  b.text(2, 1, 'top').style(2, 1, { align: { v: 'top' } });
  b.text(2, 2, 'middle').style(2, 2, { align: { v: 'middle' } });
  b.text(2, 3, 'bottom').style(2, 3, { align: { v: 'bottom' } });
  b.text(2, 4, 'rotate 45').style(2, 4, { align: { rotate: 45, wrap: 'clip', v: 'middle' } });
  b.text(2, 5, 'stacked').style(2, 5, { align: { rotate: 'stacked', h: 'center' } });
  b.text(2, 6, 'rotate -90').style(2, 6, { align: { rotate: -90, wrap: 'clip' } });
  b.text(3, 1, long).style(3, 1, { align: { wrap: 'wrap' } });
  b.text(3, 2, long).style(3, 2, { align: { wrap: 'clip' } });
  b.text(3, 3, long).style(3, 3, { align: { wrap: 'overflow' } });
  b.text(3, 5, 'stop');
  b.text(3, 6, long).style(3, 6, { align: { shrink: true, wrap: 'clip' } });
  b.text(4, 1, 'Centered across').style(4, 1, { align: { h: 'centerAcross' }, fill: '#e0e7ff' });
  b.style(4, 2, { align: { h: 'centerAcross' }, fill: '#e0e7ff' });
  b.style(4, 3, { align: { h: 'centerAcross' }, fill: '#e0e7ff' });
  b.text(4, 4, 'ab').style(4, 4, { align: { h: 'fill' } });
  b.text(4, 5, 'spread').style(4, 5, { align: { h: 'distributed' } });
  b.text(5, 1, 'bold italic').style(5, 1, { font: { bold: true, italic: true } });
  b.text(5, 2, 'underline').style(5, 2, { font: { underline: 'double', strike: 'single' } });
  b.text(5, 3, 'large').style(5, 3, { font: { size: 18 } });
  b.text(5, 4, 'brick text').style(5, 4, { font: { color: 'theme:accent2' } });
  b.text(5, 5, 'on dark').style(5, 5, { fill: '#1e293b' });
  b.text(5, 6, 'amber').style(5, 6, { fill: 'theme:accent5' });
  b.text(6, 1, 'pattern').style(6, 1, { fill: { pattern: 'darkGrid', color: '#6366f1', back: '#ffffff' } });
  b.text(6, 2, 'gradient').style(6, 2, {
    fill: {
      gradient: {
        angle: 0,
        stops: [
          { at: 0, color: '#bae6fd' },
          { at: 1, color: '#fde68a' },
        ],
      },
    },
  });
  b.text(6, 3, 'padded').style(6, 3, { pad: { t: 8, r: 12, b: 8, l: 12 }, fill: '#fef3c7' });
  b.text(6, 4, 'exact').style(6, 4, { align: { wrap: 'wrap' } });
  b.rowSettings(6, { height: 24, exact: true });
  b.text(7, 1, 'hidden row follows');
  b.rowSettings(8, { hidden: true });
  b.text(8, 1, 'You never see this row');
  b.text(9, 1, 'after the hidden row');
  b.text(9, 2, 'hidden column follows');
  b.sheet = { ...b.sheet, cols: { [K(4)]: { hidden: false } } };
  return b.build();
}

/** A tall table with a banded look, a frozen header row, and a frozen first column. */
export function freezeFixture(): Harness {
  const b = new Builder(40, 5, 110);
  b.table = { ...b.table, header: true };
  b.settings({ look: 'light-fern', band: { rows: true }, freeze: { rows: 1, cols: 1 } });
  for (let r = 1; r <= 40; r += 1) {
    b.text(r, 1, r === 1 ? 'Item' : `Row ${r - 1}`);
    for (let c = 2; c <= 5; c += 1) b.text(r, c, r === 1 ? `Column ${c - 1}` : String((r * c * 37) % 997));
  }
  return b.build();
}
