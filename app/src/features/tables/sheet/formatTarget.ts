// The cell-range format target (owner: tables:toolbar). The shared format commands (Bold, Italic, Text color, size,
// alignment, Clear formatting) ask the format target seam first (editor/commands/formatTarget.ts). With whole cells
// selected, this target claims the request and writes a cell style into `data.sheet` instead of marks into the
// text. With a caret or selected text in a cell, no target claims it, and the mark is toggled as before.
//
// The planning is pure (`planFormat`, `boxOfSelection`), so tests run it without an editor. `writeFormat` sends
// the change as one data patch, so Undo takes it back in one step.

import type { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import type { EditorState } from '@tiptap/pm/state';
import { registerFormatTarget } from '../../../editor/commands/formatTarget';
import type { FormatRequest, FormatTarget } from '../../../editor/commands/formatTarget';
import { BODY_POINTS, nudgeSize, parseSizeInput, pointsOf, stepSize } from '../../../editor/commands/sizes';
import { parseCell, serializeCell } from '../../../editor/markdown';
import type { MarkdownCache } from '../../../editor/markdown';
import type { TableData } from '../../../editor/schema/specs';
import { t } from '../../../strings/t';
import { applyToRange, readSheet, resolve, sheetPatch } from './model';
import type { Box, CellStyle, Sheet, StyleChange } from './model';

/** What a format needs of the table block that holds the cells (the table extra's host has all of it). */
export interface CellHost {
  readonly editor: Editor;
  readonly cache: MarkdownCache;
  data(): Record<string, unknown>;
  table(): TableData;
  apply(change: (data: TableData) => TableData | null, extra?: Record<string, unknown>): Promise<boolean>;
  patch(data: Record<string, unknown>): Promise<unknown>;
  announce(text: string): void;
}

/** The cells of a box, by position, both ends included. */
export type CellBox = Box;

/** A box with the change to apply to its cells. */
export interface Step {
  box: CellBox;
  change: StyleChange;
}

/** What one format does: cell style changes, and the text marks the cell's runs lose so the style shows. */
export interface Plan {
  steps: Step[];
  strip: readonly string[];
}

/** The marks of a cell's runs that the cell-wide format of the same name replaces. */
const STRIPPED: Readonly<Record<string, readonly string[]>> = {
  bold: ['bold', 'weight'],
  italic: ['italic'],
  underline: ['underline'],
  strike: ['strike'],
  textColor: ['textColor'],
  textSize: ['textSize'],
  clear: [
    'bold',
    'weight',
    'italic',
    'underline',
    'strike',
    'textColor',
    'textSize',
    'font',
    'subscript',
    'superscript',
  ],
};

/** The box of the selected cells, or of the cell holding the caret, or null outside a table of this data. */
export function boxOfSelection(state: EditorState, table: TableData): CellBox | null {
  const { selection } = state;
  const rows = table.rows.length;
  const cols = table.columns.length;
  let anchor: number;
  let head: number;
  let node: PMNode;
  let start: number;
  if (selection instanceof CellSelection) {
    anchor = selection.$anchorCell.pos;
    head = selection.$headCell.pos;
    node = selection.$anchorCell.node(-1);
    start = selection.$anchorCell.start(-1);
  } else {
    const $from = selection.$from;
    let depth = $from.depth;
    while (
      depth > 0 &&
      $from.node(depth).type.spec.tableRole !== 'cell' &&
      $from.node(depth).type.spec.tableRole !== 'header_cell'
    )
      depth--;
    if (depth < 1) return null;
    anchor = head = $from.before(depth);
    node = $from.node(depth - 2);
    start = $from.start(depth - 2);
  }
  if (node.type.spec.tableRole !== 'table') return null;
  const map = TableMap.get(node);
  if (map.height !== rows || map.width !== cols) return null;
  const rect = map.rectBetween(anchor - start, head - start);
  return { top: rect.top, left: rect.left, bottom: rect.bottom - 1, right: rect.right - 1 };
}

const sizeOf = (style: CellStyle): number => style.font?.size ?? BODY_POINTS;

/** The style of the cell at a position, as the table draws it. */
export function styleAt(sheet: Sheet, table: TableData, row: number, col: number): CellStyle {
  return resolve(sheet, table, table.rows[row].id, table.columns[col].id).style;
}

/** The cell style changes for a request, or null when the cell does not take it. `style` is the active cell's. */
export function planFormat(request: FormatRequest, box: CellBox, style: CellStyle): Plan | null {
  const whole = (change: StyleChange, strip: readonly string[] = []): Plan => ({ steps: [{ box, change }], strip });
  switch (request.format) {
    case 'bold':
      return whole({ font: { bold: !style.font?.bold } }, STRIPPED.bold);
    case 'italic':
      return whole({ font: { italic: !style.font?.italic } }, STRIPPED.italic);
    case 'underline': {
      const on = style.font?.underline !== undefined && style.font.underline !== 'none';
      return whole({ font: { underline: on ? 'none' : 'single' } }, STRIPPED.underline);
    }
    case 'strike':
      return whole({ font: { strike: style.font?.strike === 'single' ? 'none' : 'single' } }, STRIPPED.strike);
    case 'subscript':
      return whole({ font: { script: style.font?.script === 'sub' ? 'none' : 'sub' } }, STRIPPED.clear);
    case 'superscript':
      return whole({ font: { script: style.font?.script === 'super' ? 'none' : 'super' } }, STRIPPED.clear);
    case 'textColor':
      return whole({ font: { color: request.color } }, STRIPPED.textColor);
    case 'textSize': {
      if (request.size === null) return whole({ font: { size: null } }, STRIPPED.textSize);
      const points = pointsOf(request.size) ?? parseSizeInput(request.size);
      return points === null ? null : whole({ font: { size: points } }, STRIPPED.textSize);
    }
    case 'textSizeStep': {
      const now = sizeOf(style);
      const next = request.by === 'point' ? nudgeSize(now, request.direction) : stepSize(now, request.direction);
      return whole({ font: { size: next } }, STRIPPED.textSize);
    }
    case 'clear':
      return whole({ fmt: null, font: null, fill: null, border: null, align: null, pad: null }, STRIPPED.clear);
    case 'align': {
      const h = {
        left: 'left',
        center: 'center',
        right: 'right',
        justify: 'justify',
        distribute: 'distributed',
      } as const;
      return whole({ align: { h: h[request.align] } });
    }
    default:
      return null;
  }
}

/** The ID corners of a box. */
const corners = (table: TableData, box: CellBox): { from: [string, string]; to: [string, string] } => ({
  from: [table.rows[box.top].id, table.columns[box.left].id],
  to: [table.rows[box.bottom].id, table.columns[box.right].id],
});

export interface Written {
  sheet: Sheet;
  /** The merge patch of the block's data, or null when nothing changed. */
  patch: Record<string, unknown> | null;
  refused?: 'styles';
}

/** Applies each step in turn to a copy of the sheet. One patch covers them all. */
export function writeSteps(before: Sheet, table: TableData, steps: readonly Step[]): Written {
  let sheet = before;
  for (const step of steps) {
    const { from, to } = corners(table, step.box);
    const applied = applyToRange(sheet, table, from, to, step.change);
    if (applied.refused) return { sheet: before, patch: null, refused: applied.refused };
    sheet = applied.sheet;
  }
  return { sheet, patch: sheetPatch(before, sheet) };
}

/** The table without the marks `marks` in the runs of the cells of `box`, or null when no cell had one. */
export function stripMarks(
  data: TableData,
  box: CellBox,
  marks: readonly string[],
  cache: MarkdownCache,
): TableData | null {
  if (marks.length === 0) return null;
  let changed = false;
  const rows = data.rows.map((row, r) => {
    if (r < box.top || r > box.bottom) return row;
    let cells = row.cells;
    for (let c = box.left; c <= box.right; c++) {
      const id = data.columns[c].id;
      const markdown = cells[id]?.markdown ?? '';
      if (markdown === '') continue;
      const paragraph = parseCell(markdown);
      const kids: PMNode[] = [];
      let touched = false;
      paragraph.forEach((child) => {
        const kept = child.marks.filter((mark) => !marks.includes(mark.type.name));
        if (kept.length !== child.marks.length) touched = true;
        kids.push(child.mark(kept));
      });
      if (!touched) continue;
      const next = serializeCell(paragraph.copy(Fragment.from(kids)), cache);
      if (next === markdown) continue;
      changed = true;
      cells = { ...cells, [id]: { ...cells[id], markdown: next } };
    }
    return cells === row.cells ? row : { ...row, cells };
  });
  return changed ? { ...data, rows } : null;
}

/** Selects the cells of a box again, as whole cells. */
export function selectBox(editor: Editor, box: CellBox): void {
  const { doc } = editor.state;
  let table: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (table || node.type.spec.tableRole !== 'table') return table === null;
    table = { node, pos };
    return false;
  });
  const found = table as { node: PMNode; pos: number } | null;
  if (!found) return;
  const map = TableMap.get(found.node);
  if (box.bottom >= map.height || box.right >= map.width) return;
  const start = found.pos + 1;
  const anchor = start + map.map[box.top * map.width + box.left];
  const head = start + map.map[box.bottom * map.width + box.right];
  editor.view.dispatch(
    editor.state.tr.setSelection(CellSelection.create(doc, anchor, head)).setMeta('addToHistory', false),
  );
}

/** Writes steps and the mark removal as one change. Returns whether anything changed. */
export async function writeFormat(
  host: CellHost,
  steps: readonly Step[],
  strip: readonly string[] = [],
  box: CellBox = steps[0].box,
): Promise<boolean> {
  const table = host.table();
  const written = writeSteps(readSheet(host.data()), table, steps);
  if (written.refused) {
    host.announce(t('sheetToolbar.announce.tooMany'));
    return false;
  }
  const stripped = stripMarks(table, box, strip, host.cache);
  if (stripped) {
    const whole = host.editor.state.selection instanceof CellSelection;
    const ok = await host.apply(() => stripped, written.patch ?? {});
    // The block shows its new rows by replacing the document, which leaves a caret: put the cells back.
    if (whole && ok) selectBox(host.editor, box);
    return ok;
  }
  if (!written.patch) return false;
  await host.patch(written.patch);
  return true;
}

/** The cell target: claims whole cells of a table block that has a host, and writes the request as a cell style. */
export function createCellRangeTarget(hostOf: (state: EditorState) => CellHost | undefined): FormatTarget {
  return {
    id: 'tables.cellRange',
    claims: (state) => state.selection instanceof CellSelection && hostOf(state) !== undefined,
    apply(request, state, dispatch) {
      const host = hostOf(state);
      if (!host) return false;
      const table = host.table();
      const box = boxOfSelection(state, table);
      if (!box) return false;
      const style = styleAt(readSheet(host.data()), table, box.top, box.left);
      const plan = planFormat(request, box, style);
      if (!plan) return false;
      // With no dispatch the command only asks whether it could. The write goes through the block's own sync.
      if (dispatch) void writeFormat(host, plan.steps, plan.strip, box);
      return true;
    },
  };
}

/** Adds the target for the hosts `hostOf` knows. Returns a function that takes it away. */
export function registerCellRangeTarget(hostOf: (state: EditorState) => CellHost | undefined): () => void {
  return registerFormatTarget(createCellRangeTarget(hostOf));
}
