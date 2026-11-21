// What the pointer does to a table: fills (content in one editor transaction, formats in the sheet), and a
// selection that touch handles move. The gestures in layer.ts call these; tests call them directly, since a
// test document has no layout.
import type { Fragment } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import { t } from '../../../strings/t';
import type { SeriesOptions } from '../engine/series';
import { gridOf, placedAt, selectCells, setCellContent, sheetKeysKey, textsOf, contentOf } from '../keys/state';
import type { SheetMeta } from '../keys/state';
import type { Box, GridCell } from '../keys/grid';
import { readSheet, sheetPatch, styleById } from '../sheet/model';
import type { CellStyle, Sheet, StyleChange } from '../sheet/model';
import { writeFormat } from '../sheet/formatTarget';
import type { CellHost, Step } from '../sheet/formatTarget';
import { edgesAlong } from './borders';
import type { Edge, Lines, Point } from './borders';
import { planFill } from './fill';
import type { Direction, FillMode, FillWrite } from './fill';

/** What a fill changed, kept so the menu after the drop can write the other kinds of fill over it. */
export interface FillDrop {
  source: Box;
  box: Box;
  direction: Direction;
  /** The content the new cells had before, by "row,column". */
  before: Map<string, Fragment>;
  /** The sheet before the fill wrote any formats, so another kind of fill can start from it. */
  sheet: Sheet;
}

const key = (at: GridCell) => `${at.row},${at.column}`;

/** Selects the box, keeping the active cell where it is. */
function selectBox(tr: Transaction, box: Box, active: GridCell): Transaction {
  const a = placedAt(tr.doc, { row: box.top, column: box.left });
  const h = placedAt(tr.doc, { row: box.bottom, column: box.right });
  if (a && h) tr.setSelection(CellSelection.create(tr.doc, a.pos, h.pos));
  tr.setMeta(sheetKeysKey, { active, entry: null } satisfies SheetMeta);
  return tr;
}

/** The cells a drop writes to, outside the source. */
function newCells(drop: Pick<FillDrop, 'source' | 'box'>): GridCell[] {
  const out: GridCell[] = [];
  for (let row = drop.box.top; row <= drop.box.bottom; row++)
    for (let column = drop.box.left; column <= drop.box.right; column++) {
      const inside =
        row >= drop.source.top &&
        row <= drop.source.bottom &&
        column >= drop.source.left &&
        column <= drop.source.right;
      if (!inside) out.push({ row, column });
    }
  return out;
}

/** Fills from `source` out to `box`. Writes the content as one step; the caller then writes formats. */
export function fillContent(
  view: EditorView,
  drop: Pick<FillDrop, 'source' | 'box' | 'direction'>,
  mode: FillMode,
  options?: SeriesOptions,
  before?: Map<string, Fragment>,
): { writes: FillWrite[]; formats: boolean; before: Map<string, Fragment> } {
  const { state } = view;
  const texts = textsOf(state.doc);
  const plan = planFill(texts, drop.source, drop.box, drop.direction, mode, options);
  const kept = before ?? new Map(newCells(drop).map((at) => [key(at), contentOf(state.doc, at)] as const));
  const tr = state.tr;
  const from = (at: GridCell) => texts[at.row]?.[at.column] ?? '';
  for (const cell of newCells(drop)) {
    const write = plan.writes.find((w) => w.at.row === cell.row && w.at.column === cell.column);
    // Formats-only puts back what the cell held before; every other mode writes the plan's text.
    if (!write || write.text === null) {
      const old = kept.get(key(cell));
      if (old) setCellContent(tr, cell, old);
    } else if (write.text === from(write.from)) setCellContent(tr, cell, contentOf(state.doc, write.from));
    else setCellContent(tr, cell, write.text);
  }
  const active = gridOf(state)?.active ?? { row: drop.source.top, column: drop.source.left };
  selectBox(tr, drop.box, active);
  view.dispatch(tr);
  return { ...plan, before: kept };
}

const CLEAR: StyleChange = { fmt: null, font: null, fill: null, border: null, align: null, pad: null };

/** The formats of the source cells written to the cells that copy them. One write, one undo step. */
export async function fillFormats(host: CellHost, writes: readonly FillWrite[]): Promise<boolean> {
  if (writes.length === 0) return false;
  const table = host.table();
  const sheet = readSheet(host.data());
  const cells = (sheet.cells ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const styleOf = (at: GridCell): CellStyle | undefined => {
    const id = cells[table.rows[at.row]?.id]?.[table.columns[at.column]?.id];
    return typeof id === 'string' ? styleById(sheet, id) : undefined;
  };
  const steps: Step[] = [];
  for (const write of writes) {
    const style = styleOf(write.from);
    // Nothing to copy, and nothing to clear: leave the cell out.
    if (!style && !styleOf(write.at)) continue;
    steps.push({
      box: { top: write.at.row, left: write.at.column, bottom: write.at.row, right: write.at.column },
      change: { ...CLEAR, ...(style as StyleChange | undefined) },
    });
  }
  return steps.length > 0 ? writeFormat(host, steps, [], steps[0].box) : false;
}

/** Puts the sheet back the way it was before a fill wrote formats. */
export async function restoreFormats(host: CellHost, drop: FillDrop): Promise<void> {
  const patch = sheetPatch(readSheet(host.data()), drop.sheet);
  if (patch) await host.patch(patch);
}

/**
 * A fill from the pointer: content, then formats unless the mode leaves them out. Announces it. `again` is the drop
 * of an earlier fill over the same cells, whose first content, and first sheet, the new fill starts from.
 */
export async function fill(
  view: EditorView,
  host: CellHost,
  drop: Pick<FillDrop, 'source' | 'box' | 'direction'>,
  mode: FillMode,
  options?: SeriesOptions,
  again?: FillDrop,
): Promise<FillDrop> {
  const sheet = again?.sheet ?? readSheet(host.data());
  const done = fillContent(view, drop, mode, options, again?.before);
  if (done.formats) await fillFormats(host, done.writes);
  host.announce(
    t(mode === 'formats' ? 'sheetPointer.fill.filledFormats' : 'sheetPointer.fill.filled', {
      count: done.writes.length,
    }),
  );
  return { source: drop.source, box: drop.box, direction: drop.direction, before: done.before, sheet };
}

/** Selects the box between two cells, with `anchor` the active cell. Touch handles use it as they move. */
export function selectRange(view: EditorView, anchor: GridCell, head: GridCell): boolean {
  const tr = selectCells(view.state, anchor, head, anchor);
  if (!tr) return false;
  view.dispatch(tr);
  return true;
}

/** The steps that draw (or with `draw` false erase) the sides of a stroke's edges. */
export function borderSteps(edges: readonly Edge[], draw: boolean): Step[] {
  return edges.map(({ cell, side }) => ({
    box: { top: cell.row, left: cell.column, bottom: cell.row, right: cell.column },
    change: { border: { [side]: draw ? { style: 'thin' } : null } } as StyleChange,
  }));
}

/** Draws or erases the borders a stroke follows. Returns how many cell sides it wrote. */
export async function strokeBorders(
  host: CellHost,
  stroke: readonly Point[],
  lines: Lines,
  draw: boolean,
): Promise<number> {
  const edges = edgesAlong(stroke, lines);
  if (edges.length === 0) return 0;
  const steps = borderSteps(edges, draw);
  const ok = await writeFormat(host, steps, [], steps[0].box);
  if (ok) host.announce(t(draw ? 'sheetPointer.border.drawn' : 'sheetPointer.border.erased', { count: edges.length }));
  return ok ? edges.length : 0;
}
