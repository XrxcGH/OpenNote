// Plans a paste into a table (ADR 0067): the new rows and columns, and the sheet patch, as one change the table
// block sends as one undo step. Pure: tests run it without an editor.
//
// The clip lands at the selection's first cell. When the selection is a whole multiple of the clip's size, the clip
// repeats to fill it, as in a spreadsheet. The table grows when the clip reaches past its last row or column.
// A formula is written for the cell it lands in: R1C1 steps count from that cell, and absolute rows lose one when
// the table has a header row, since OpenNote's A1 is the first row below the header (ADR 0058).

import { serializeInline, TITLE } from '../../../editor/markdown';
import { DEFAULT_COLUMN_WIDTH } from '../../../editor/schema/specs';
import type { TableData, TableRowData } from '../../../editor/schema/specs';
import { textSchema } from '../../../editor/schema/schema';
import type { Node as PMNode } from '@tiptap/pm/model';
import { lettersFromColumn } from '../../../core/expr';
import type { Clip, ClipCell } from '../engine/paste/clip';
import { isFormula, r1c1ToA1 } from '../engine/paste/formula';
import { MAX_COLUMNS, MAX_ROWS } from '../engine/paste/infer';
import {
  addMerge,
  gridOf,
  intern,
  mergeSet,
  readableText,
  removeMerge,
  sheetPatch,
  StyleLimitError,
  styleById,
  tidy,
} from '../sheet/model';
import type { Box, CellStyle, JsonObject, Sheet } from '../sheet/model';
import { clone, own, ownObject, put } from '../sheet/model/json';
import { pasteRules, type RuleCell } from './rules';
import { OPERATOR, operate, partsOf, transposeClip, type PasteSpecial } from './special';

export interface PasteTarget {
  table: TableData;
  sheet: Sheet;
  /** The selected cells by grid position, the header row included. */
  box: Box;
  /** This table block's ID, for Paste link within the same table. */
  block?: string;
  /** The open page's ID: Paste link writes a reference to another table only when the copy came from this page. */
  page?: string;
}

/** Things the paste could not do, or did differently, for the announcement. */
export type PasteReport =
  'link' | 'styles' | 'merges' | 'header' | 'asValues' | 'dropped' | 'equalsText' | 'validation' | 'divide';

export interface PastePlan {
  table: TableData;
  /** The block data patch of `data.sheet`, or null when the sheet did not change. */
  patch: JsonObject | null;
  /** Where the clip landed. */
  box: Box;
  report: PasteReport[];
}

export interface PasteDeps {
  newId(): string;
  /** The time a pasted note is stamped with (ISO 8601). */
  now?: string;
}

const { nodes } = textSchema;

/** Plain text as a cell's Markdown: each line break is a hard break, and Markdown characters are escaped. */
export function textMarkdown(text: string): string {
  const inline: PMNode[] = [];
  text
    .replace(/\r\n?/g, '\n')
    .replace(/\0/g, '�')
    .split('\n')
    .forEach((line, i) => {
      if (i > 0) inline.push(nodes.hardBreak.create());
      if (line !== '') inline.push(textSchema.text(line));
    });
  return serializeInline(nodes.paragraph.create(null, inline), TITLE).trim();
}

/** The source marks the cell as text: a Sheets string value, or the text number format "@" (Excel's \@). */
const isTextCell = (cell: ClipCell): boolean => cell.textOnly === true || cell.style?.fmt === '@';

const isBlank = (cell: ClipCell): boolean =>
  cell.text.trim() === '' && !cell.formula && cell.num === undefined && cell.bool === undefined && !cell.markdown;

/** The number a cell holds: its own value, or its text read as an invariant number. */
function numberOf(text: string): number | null {
  const t = text.trim().replace(/,/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A cell's value as text: the number, TRUE or FALSE, the error, or the shown text. */
function valueText(cell: ClipCell): string {
  if (cell.num !== undefined) return String(cell.num);
  if (cell.bool !== undefined) return cell.bool ? 'TRUE' : 'FALSE';
  if (cell.error) return cell.error;
  return cell.text;
}

/** The repeat count that fills the selection, or 1 when the selection is not a whole multiple of the clip. */
function repeats(selected: number, size: number, hasSpans: boolean): number {
  return !hasSpans && selected > size && selected % size === 0 ? selected / size : 1;
}

/** The table with rows and columns added so the grid reaches `rows` by `cols`. */
function grown(table: TableData, rows: number, cols: number, newId: () => string): TableData {
  if (rows <= table.rows.length && cols <= table.columns.length) return table;
  const columns = [...table.columns];
  while (columns.length < cols) columns.push({ id: newId(), width: DEFAULT_COLUMN_WIDTH });
  const added = columns.slice(table.columns.length);
  const blank = (): TableRowData['cells'] => Object.fromEntries(columns.map((c) => [c.id, { markdown: '' }]));
  const out: TableRowData[] = table.rows.map((row) =>
    added.length === 0
      ? row
      : { ...row, cells: { ...row.cells, ...Object.fromEntries(added.map((c) => [c.id, { markdown: '' }])) } },
  );
  while (out.length < rows) out.push({ id: newId(), cells: blank() });
  return { ...table, columns, rows: out };
}

function setStyle(sheet: Sheet, row: string, col: string, style: CellStyle | undefined): void {
  const id = style ? intern(sheet, style as JsonObject) : null;
  const cells = ownObject(sheet, 'cells') ?? {};
  const byCol = ownObject(cells, row) ?? {};
  if (id === null) delete byCol[col];
  else put(byCol, col, id);
  if (Object.keys(byCol).length > 0) put(cells, row, byCol);
  else delete cells[row];
  if (Object.keys(cells).length > 0) put(sheet, 'cells', cells);
  else delete sheet.cells;
}

function cellStyle(sheet: Sheet, row: string, col: string): CellStyle | undefined {
  return styleById(sheet, own(ownObject(ownObject(sheet, 'cells'), row), col));
}

/** The style a cell gets: the clip's whole style, all of it but borders, or only its number format. */
function styleFor(kind: 'all' | 'noBorders' | 'fmt', pasted: CellStyle | undefined, before: CellStyle | undefined) {
  if (kind === 'all') return pasted;
  if (kind === 'noBorders') {
    const { border: _gone, ...rest } = pasted ?? {};
    return before?.border ? { ...rest, border: before.border } : rest;
  }
  const { fmt: _old, ...rest } = before ?? {};
  return pasted?.fmt ? { ...rest, fmt: pasted.fmt } : rest;
}

function setNote(sheet: Sheet, row: string, col: string, note: string | undefined, now: string): void {
  const notes = ownObject(sheet, 'notes') ?? {};
  const byCol = ownObject(notes, row) ?? {};
  if (note) put(byCol, col, { markdown: note, at: now });
  else delete byCol[col];
  if (Object.keys(byCol).length > 0) put(notes, row, byCol);
  else delete notes[row];
  if (Object.keys(notes).length > 0) put(sheet, 'notes', notes);
  else delete sheet.notes;
}

interface Context {
  clip: Clip;
  special: PasteSpecial;
  header: number;
  target: PasteTarget;
  report: Set<PasteReport>;
}

/** A reference to the copied cell for Paste link, or null when the copy is not from this page's OpenNote table. */
function linkText(ctx: Context, r: number, c: number): string | null {
  const link = ctx.clip.link;
  if (!link) return null;
  const row = link.top + r - (link.header ? 1 : 0);
  if (row < 0) return null;
  const ref = `${lettersFromColumn(link.left + c)}${row + 1}`;
  if (link.block === ctx.target.block) return `=${ref}`;
  // Another table: only one on this page (DESIGN 13.7), and only by its name.
  const samePage = link.page !== undefined && link.page === ctx.target.page;
  return samePage && link.name ? `=${link.name}!${ref}` : null;
}

/** The text a cell gets, or null to leave it as it is. */
function contentFor(ctx: Context, cell: ClipCell, at: { row: number; col: number }, r: number, c: number) {
  const parts = partsOf(ctx.special.what);
  if (ctx.special.link) {
    const text = linkText(ctx, r, c);
    if (text === null) ctx.report.add('link');
    return text;
  }
  if (parts.formulas && cell.formula) {
    if (at.row < 0) return textMarkdown(valueText(cell));
    return textMarkdown(r1c1ToA1(cell.formula, at, ctx.header));
  }
  if (parts.formulas && cell.markdown !== undefined) return cell.markdown;
  const value = valueText(cell);
  // A cell the source marks as text keeps such a value as text (planPaste gives it the "@" format). Any other value
  // that starts with "=" works as a formula, as typed text does; the paste says so.
  if (isFormula(value.trim()) && !isTextCell(cell)) ctx.report.add('equalsText');
  return textMarkdown(value);
}

/** The text after an operation with the cell already there, or null to leave the cell. */
function operated(ctx: Context, cell: ClipCell, before: string): string | null {
  const op = ctx.special.operation;
  const pasted = cell.num ?? numberOf(cell.text);
  if (pasted === null || cell.formula) return null;
  const text = readableText(before).trim();
  if (isFormula(text)) return textMarkdown(`=(${text.slice(1)})${OPERATOR[op]}${pasted}`);
  const old = text === '' ? 0 : numberOf(text);
  if (old === null) return null;
  const out = operate(op, old, pasted);
  if (out !== null) return textMarkdown(String(out));
  ctx.report.add('divide');
  return textMarkdown('#DIV/0!');
}

/**
 * Whether a pasted cell must keep its text as text: the source marks it as text and the text starts with "=". The
 * cell then gets the "@" number format, which the engine never reads as a formula (smart/model.ts).
 */
function keepsText(special: PasteSpecial, cell: ClipCell, markdown: string | undefined): boolean {
  if (special.link || special.operation !== 'none' || cell.formula || markdown === undefined) return false;
  if (!partsOf(special.what).content || !isTextCell(cell)) return false;
  return isFormula(readableText(markdown).trim());
}

/** Plans the paste of `clip` into the target with the paste special choice. Returns null when the clip is empty. */
export function planPaste(target: PasteTarget, input: Clip, special: PasteSpecial, deps: PasteDeps): PastePlan | null {
  const clip = special.transpose ? transposeClip(input) : input;
  const height = clip.rows.length;
  const width = clip.rows[0]?.length ?? 0;
  if (height === 0 || width === 0) return null;
  const parts = partsOf(special.what);
  const report = new Set<PasteReport>();
  if (special.link && !clip.link) report.add('link');
  if (clip.asValues && parts.formulas) report.add('asValues');
  if (clip.dropped) report.add('dropped');
  const { box } = target;
  const spans = clip.spans.length > 0;
  const down = repeats(box.bottom - box.top + 1, height, spans);
  const across = repeats(box.right - box.left + 1, width, spans);
  // The table grows no further than a pasted table may be (infer.ts), or than it already is.
  const lastRow = Math.max(MAX_ROWS + (target.table.header ? 1 : 0), target.table.rows.length) - 1;
  const lastCol = Math.max(MAX_COLUMNS, target.table.columns.length) - 1;
  const area: Box = {
    top: box.top,
    left: box.left,
    bottom: Math.min(box.top + height * down - 1, lastRow),
    right: Math.min(box.left + width * across - 1, lastCol),
  };
  if (area.bottom < box.top + height * down - 1 || area.right < box.left + width * across - 1) report.add('dropped');
  if (area.bottom < area.top || area.right < area.left)
    return { table: target.table, patch: null, box, report: [...report] };
  const table =
    parts.content || parts.style !== 'none' || parts.notes || special.link
      ? grown(target.table, area.bottom + 1, area.right + 1, deps.newId)
      : target.table;
  const header = table.header ? 1 : 0;
  const ctx: Context = { clip, special, header, target, report };
  const before = target.sheet;
  const sheet = clone(before);
  const grid = gridOf(table);
  const rows = table.rows.map((row) => ({ ...row, cells: { ...row.cells } }));
  const now = deps.now ?? new Date().toISOString();
  // Validation rules land only from an OpenNote copy on this page; the transposed clip has no link, so read the input.
  const rulesHere = parts.validation && clip.source === 'opennote';
  const samePage = input.link?.page !== undefined && input.link.page === target.page;
  if (rulesHere && clip.rules && !samePage) report.add('validation');
  const ruleCells: RuleCell[] = [];
  try {
    for (let gr = area.top; gr <= area.bottom; gr++) {
      for (let gc = area.left; gc <= area.right; gc++) {
        const r = (gr - area.top) % height;
        const c = (gc - area.left) % width;
        const cell = clip.rows[r][c];
        if (special.skipBlanks && isBlank(cell)) continue;
        const rowId = grid.rows[gr];
        const colId = grid.cols[gc];
        const row = rows[gr];
        if (parts.content || special.link) {
          const old = row.cells[colId]?.markdown ?? '';
          const text =
            special.operation !== 'none' && !special.link
              ? operated(ctx, cell, old)
              : contentFor(ctx, cell, { row: gr - header, col: gc }, r, c);
          if (text !== null) row.cells[colId] = { ...row.cells[colId], markdown: text };
          if (gr < header && cell.formula && parts.formulas) report.add('header');
        }
        if (parts.style !== 'none') {
          setStyle(sheet, rowId, colId, styleFor(parts.style, cell.style, cellStyle(sheet, rowId, colId)));
        }
        if (keepsText(special, cell, row.cells[colId]?.markdown)) {
          setStyle(sheet, rowId, colId, { ...cellStyle(sheet, rowId, colId), fmt: '@' });
        }
        if (rulesHere && samePage) ruleCells.push({ row: gr, col: gc, rule: cell.rule });
        if (parts.notes && (clip.source === 'opennote' || cell.note)) setNote(sheet, rowId, colId, cell.note, now);
      }
    }
  } catch (error) {
    if (!(error instanceof StyleLimitError)) throw error;
    return { table: target.table, patch: null, box: area, report: ['styles'] };
  }
  const out: TableData = { ...table, rows };
  if (ruleCells.length > 0 && !pasteRules(sheet, out, clip.rules ?? [], ruleCells)) report.add('validation');
  if (parts.merges) pasteMerges(sheet, out, clip, area, height, width, report);
  if (parts.widths) widen(out, clip, area);
  tidy(sheet, out);
  return { table: out, patch: sheetPatch(before, sheet), box: area, report: [...report] };
}

/**
 * What a cut leaves: the cut cells empty, with no style, no note, and no merge inside the box, as a spreadsheet's
 * cut moves all of a cell. One change, so it is one undo step.
 */
export function planCut(table: TableData, before: Sheet, box: Box): { table: TableData; patch: JsonObject | null } {
  const sheet = clone(before);
  const grid = gridOf(table);
  for (const merge of mergeSet(sheet, table).list) {
    const b = merge.box;
    if (b.top >= box.top && b.bottom <= box.bottom && b.left >= box.left && b.right <= box.right) {
      removeMerge(sheet, merge.id);
    }
  }
  const rows = table.rows.map((row, r) => {
    if (r < box.top || r > box.bottom) return row;
    const cells = { ...row.cells };
    for (let c = box.left; c <= box.right; c++) {
      const colId = grid.cols[c];
      if (colId === undefined) continue;
      if (cells[colId]) cells[colId] = { ...cells[colId], markdown: '' };
      setStyle(sheet, row.id, colId, undefined);
      setNote(sheet, row.id, colId, undefined, '');
    }
    return { ...row, cells };
  });
  const out: TableData = { ...table, rows };
  tidy(sheet, out);
  return { table: out, patch: sheetPatch(before, sheet) };
}

/** Removes the merges that touch the pasted area and adds the clip's, offset to where it landed. */
function pasteMerges(
  sheet: Sheet,
  table: TableData,
  clip: Clip,
  area: Box,
  height: number,
  width: number,
  report: Set<PasteReport>,
): void {
  const grid = gridOf(table);
  for (const merge of mergeSet(sheet, table).list) {
    const b = merge.box;
    if (b.bottom < area.top || b.top > area.bottom || b.right < area.left || b.left > area.right) continue;
    removeMerge(sheet, merge.id);
  }
  const active = mergeSet(sheet, table);
  for (let top = area.top; top <= area.bottom; top += height) {
    for (let left = area.left; left <= area.right; left += width) {
      for (const span of clip.spans) {
        const r1 = top + span.row;
        const c1 = left + span.col;
        const r2 = r1 + span.rows - 1;
        const c2 = c1 + span.cols - 1;
        if (r2 >= grid.rows.length || c2 >= grid.cols.length) continue;
        const done = addMerge(sheet, table, [grid.rows[r1], grid.cols[c1]], [grid.rows[r2], grid.cols[c2]], active);
        if ('refused' in done) report.add('merges');
      }
    }
  }
}

/** Column widths of the clip on the columns it landed in. Widths are CSS pixels, which are page units. */
function widen(table: TableData, clip: Clip, area: Box): void {
  const width = clip.rows[0].length;
  table.columns = table.columns.map((column, c) => {
    if (c < area.left || c > area.right) return column;
    const w = clip.widths[(c - area.left) % width];
    return typeof w === 'number' ? { ...column, width: Math.round(Math.max(24, Math.min(w, 2000))) } : column;
  });
}
