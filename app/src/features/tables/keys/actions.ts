// The actions of the sheet commands (ADR 0063): entries, fills, and clearing. Also the date and the time, the
// cell above, and the switch to document keys. Each runs on a view, in Grid mode or Edit mode.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import type { CommandId } from '../../../commands/types';
import { t } from '../../../strings/t';
import { daysToYmd, todayDays } from '../engine/dates';
import type { DateOrder } from '../engine/locale';
import { filledText } from '../smart/fill';
import { address, lastUsed } from './grid';
import type { Box, GridCell } from './grid';
import { advance, commitBy, extend, extendBy, jumpBy, move, moveBy, pageOf, selectBox, selectRegion } from './moves';
import type { Ctx } from './moves';
import {
  activeCell,
  caretAtEnd,
  contentOf,
  gridOf,
  hasHeader,
  modeOf,
  placedAt,
  setCellContent,
  sheetKeysKey,
  textRange,
  textsOf,
} from './state';
import type { Entry, SheetKeysOptions, SheetMeta, SheetMode } from './state';

/** Starts an entry: the cell's content replaced (or kept), the caret at its end. */
export function startEntry(ctx: Ctx, at: GridCell, content: Fragment | string | null, mode: Entry['mode']): boolean {
  const before = contentOf(ctx.state.doc, at);
  const tr = ctx.state.tr;
  if (content !== null) setCellContent(tr, at, content);
  caretAtEnd(tr, at);
  ctx.dispatch(tr.setMeta(sheetKeysKey, { entry: { ...at, before, mode }, active: null } satisfies SheetMeta));
  return true;
}

export function typeOver(ctx: Ctx, text: string): boolean {
  const at = activeCell(ctx.state);
  return at ? startEntry(ctx, at, text, 'enter') : false;
}

export function cancel(ctx: Ctx): boolean {
  const at = activeCell(ctx.state);
  if (!at) return false;
  const entry = sheetKeysKey.getState(ctx.state)?.entry;
  const tr = ctx.state.tr;
  const before = entry && entry.row === at.row && entry.column === at.column ? entry.before : null;
  // Nothing to put back when the text is as it was, such as after a click into the cell and no typing.
  const restore = before !== null && !before.eq(contentOf(ctx.state.doc, at));
  if (restore) setCellContent(tr, at, before);
  const cell = placedAt(tr.doc, at);
  if (cell) tr.setSelection(CellSelection.create(tr.doc, cell.pos));
  ctx.dispatch(tr.setMeta(sheetKeysKey, { entry: null, active: null } satisfies SheetMeta));
  if (restore) ctx.options.announce(t('sheetKeys.announce.canceled'));
  return true;
}

/** Each cell of the box, top to bottom and left to right. */
export function* cellsIn(box: Box): Generator<GridCell> {
  for (let row = box.top; row <= box.bottom; row++)
    for (let column = box.left; column <= box.right; column++) yield { row, column };
}

/** What a cell becomes when filled from another: a formula moves its references, other content is copied. */
function filledFrom(doc: PMNode, source: GridCell, to: GridCell): Fragment | string {
  const text = placedAt(doc, source)?.node.textContent ?? '';
  if (text.trim().startsWith('=')) return filledText(text.trim(), to.row - source.row, to.column - source.column);
  return contentOf(doc, source);
}

/** Fills cells of a box, each from the source `source(cell)` names. One undo step. */
function fill(ctx: Ctx, targets: Iterable<GridCell>, source: (at: GridCell) => GridCell | null): number {
  const { state } = ctx;
  const tr = state.tr;
  let count = 0;
  for (const at of targets) {
    const from = source(at);
    if (!from || (from.row === at.row && from.column === at.column)) continue;
    setCellContent(tr, at, filledFrom(state.doc, from, at));
    count++;
  }
  if (count > 0) {
    ctx.dispatch(tr);
    if (count > 1) ctx.options.announce(t('sheetKeys.announce.filled', { count }));
  }
  return count;
}

/** Ctrl+D and Ctrl+R: the range's first row (or column) into the rest; one cell takes the cell above (or left). */
function fillAlong(ctx: Ctx, down: boolean): boolean {
  const grid = gridOf(ctx.state);
  if (!grid) return false;
  const { box } = grid;
  const single = down ? box.top === box.bottom : box.left === box.right;
  if (single && (down ? box.top === 0 : box.left === 0)) return true;
  fill(ctx, cellsIn(box), (at) =>
    down
      ? { row: single ? at.row - 1 : box.top, column: at.column }
      : { row: at.row, column: single ? at.column - 1 : box.left },
  );
  return true;
}

function clearCells(ctx: Ctx, box: Box): boolean {
  const tr = ctx.state.tr;
  let count = 0;
  for (const at of cellsIn(box)) {
    if (contentOf(ctx.state.doc, at).size === 0) continue;
    setCellContent(tr, at, '');
    count++;
  }
  if (count === 0) return true;
  ctx.dispatch(tr);
  if (count > 1) ctx.options.announce(t('sheetKeys.announce.cleared', { count }));
  return true;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date as a person types it in the table's locale, so the engine reads it as a date. */
export function dateText(days: number, order: DateOrder): string {
  const { y, m, d } = daysToYmd(days);
  if (order === 'ymd') return `${y}-${pad(m)}-${pad(d)}`;
  return order === 'dmy' ? `${d}/${m}/${y}` : `${m}/${d}/${y}`;
}

/** The time as a person types it: "1:05 PM" in American English. */
export function timeText(now: Date, locale: string): string {
  return now.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }).replace(/[\u202f\u00a0]/g, ' ');
}

function insertStamp(ctx: Ctx, mode: SheetMode, text: string): boolean {
  if (mode === 'edit') {
    ctx.dispatch(ctx.state.tr.insertText(text).scrollIntoView());
    return true;
  }
  return typeOver(ctx, text);
}

/** Ctrl+' and Ctrl+Shift+": the formula, or the shown value, of the cell above, in Edit mode. */
function copyAbove(ctx: Ctx, value: boolean): boolean {
  const at = activeCell(ctx.state);
  if (!at || at.row === 0) return true;
  const above = { row: at.row - 1, column: at.column };
  const text = value
    ? shownText(ctx.view, ctx.options, above)
    : (placedAt(ctx.state.doc, above)?.node.textContent ?? '');
  return startEntry(ctx, at, text, 'edit');
}

export function shownText(view: EditorView, options: SheetKeysOptions, at: GridCell): string {
  const shown = (options.shown ?? domShown)(view, at);
  return shown ?? placedAt(view.state.doc, at)?.node.textContent ?? '';
}

/** A smart table draws a formula's result from the cell's data-shown attribute (smart/display.ts). */
function domShown(view: EditorView, at: GridCell): string | null {
  const cell = placedAt(view.state.doc, at);
  const dom = cell ? view.nodeDOM(cell.pos) : null;
  return dom instanceof HTMLElement ? dom.getAttribute('data-shown') || null : null;
}

function setSpreadsheet(ctx: Ctx, spreadsheet: boolean): void {
  const tr = ctx.state.tr.setMeta(sheetKeysKey, { spreadsheet, entry: null, active: null } satisfies SheetMeta);
  const at = activeCell(ctx.state);
  const cell = at && placedAt(ctx.state.doc, at);
  // Document keys have no Grid mode, so the cells become a caret in the active cell.
  if (!spreadsheet && cell && ctx.state.selection instanceof CellSelection)
    tr.setSelection(TextSelection.create(tr.doc, textRange(cell).to));
  ctx.dispatch(tr);
}

type Action = (ctx: Ctx, mode: SheetMode) => boolean;

const grid =
  (action: (ctx: Ctx) => boolean): Action =>
  (ctx, mode) =>
    mode === 'grid' ? action(ctx) : false;
const edit =
  (action: (ctx: Ctx) => boolean): Action =>
  (ctx, mode) =>
    mode === 'edit' ? action(ctx) : false;

/** The registered commands' actions, by command ID. */
const ACTIONS: Readonly<Record<string, Action>> = {
  'table.sheet.extendUp': grid((ctx) => extendBy(ctx, -1, 0)),
  'table.sheet.extendDown': grid((ctx) => extendBy(ctx, 1, 0)),
  'table.sheet.extendLeft': grid((ctx) => extendBy(ctx, 0, -1)),
  'table.sheet.extendRight': grid((ctx) => extendBy(ctx, 0, 1)),
  'table.sheet.jumpUp': grid((ctx) => jumpBy(ctx, -1, 0, false)),
  'table.sheet.jumpDown': grid((ctx) => jumpBy(ctx, 1, 0, false)),
  'table.sheet.jumpLeft': grid((ctx) => jumpBy(ctx, 0, -1, false)),
  'table.sheet.jumpRight': grid((ctx) => jumpBy(ctx, 0, 1, false)),
  'table.sheet.extendJumpUp': grid((ctx) => jumpBy(ctx, -1, 0, true)),
  'table.sheet.extendJumpDown': grid((ctx) => jumpBy(ctx, 1, 0, true)),
  'table.sheet.extendJumpLeft': grid((ctx) => jumpBy(ctx, 0, -1, true)),
  'table.sheet.extendJumpRight': grid((ctx) => jumpBy(ctx, 0, 1, true)),
  'table.sheet.firstCell': grid((ctx) => move(ctx, { row: 0, column: 0 })),
  'table.sheet.lastCell': grid((ctx) => move(ctx, lastUsed(ctx.texts))),
  'table.sheet.extendFirstCell': grid((ctx) => extend(ctx, { row: 0, column: 0 })),
  'table.sheet.extendLastCell': grid((ctx) => extend(ctx, lastUsed(ctx.texts))),
  'table.sheet.extendRowStart': grid((ctx) => extend(ctx, { row: gridOf(ctx.state)!.head.row, column: 0 })),
  'table.sheet.screenLeft': grid((ctx) => moveBy(ctx, 0, -pageOf(ctx.view, false))),
  'table.sheet.screenRight': grid((ctx) => moveBy(ctx, 0, pageOf(ctx.view, false))),
  'table.sheet.moveUp': grid((ctx) => advance(ctx, 'column', true)),
  'table.sheet.fillEntry': grid((ctx) => {
    const g = gridOf(ctx.state)!;
    fill(ctx, cellsIn(g.box), () => g.active);
    return true;
  }),
  'table.sheet.edit': grid((ctx) => {
    const at = activeCell(ctx.state)!;
    ctx.options.announce(t('sheetKeys.announce.editing', { address: address(at, hasHeader(ctx.state.doc)) }));
    return startEntry(ctx, at, null, 'edit');
  }),
  'table.sheet.clear': grid((ctx) => clearCells(ctx, gridOf(ctx.state)!.box)),
  'table.sheet.clearAndEdit': grid((ctx) => startEntry(ctx, activeCell(ctx.state)!, '', 'enter')),
  'table.sheet.selectColumn': grid((ctx) => {
    const g = gridOf(ctx.state)!;
    return selectBox(ctx, { ...g.box, top: 0, bottom: ctx.texts.length - 1 }, g.active);
  }),
  'table.sheet.selectRegion': grid(selectRegion),
  'table.sheet.fillDown': grid((ctx) => fillAlong(ctx, true)),
  'table.sheet.fillRight': grid((ctx) => fillAlong(ctx, false)),
  'table.sheet.copyFormulaAbove': grid((ctx) => copyAbove(ctx, false)),
  'table.sheet.copyValueAbove': grid((ctx) => copyAbove(ctx, true)),
  'table.sheet.insertDate': (ctx, mode) =>
    insertStamp(ctx, mode, dateText(todayDays(ctx.options.now?.()), ctx.options.dateOrder?.() ?? 'mdy')),
  'table.sheet.insertTime': (ctx, mode) =>
    insertStamp(ctx, mode, timeText(ctx.options.now?.() ?? new Date(), ctx.options.locale?.() ?? 'en-US')),
  'table.sheet.commitUp': edit((ctx) => commitBy(ctx, -1, 0)),
  'table.sheet.commitStay': edit((ctx) => commitBy(ctx, 0, 0)),
  'table.sheet.lineBreak': edit((ctx) => {
    const hardBreak = ctx.state.schema.nodes.hardBreak;
    if (!hardBreak) return false;
    ctx.dispatch(ctx.state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
    return true;
  }),
  'table.sheet.toggleEnterMode': edit((ctx) => {
    const entry = sheetKeysKey.getState(ctx.state)?.entry;
    const at = activeCell(ctx.state)!;
    const mode = entry?.mode === 'enter' ? 'edit' : 'enter';
    const next: Entry = entry ? { ...entry, mode } : { ...at, before: null, mode };
    ctx.dispatch(ctx.state.tr.setMeta(sheetKeysKey, { entry: next } satisfies SheetMeta));
    ctx.options.announce(t(mode === 'enter' ? 'sheetKeys.announce.enterMode' : 'sheetKeys.announce.editMode'));
    return true;
  }),
};

/** Runs a sheet command on the view. Document keys work in every table; the rest need spreadsheet keys. */
export function runSheetCommand(view: EditorView, options: SheetKeysOptions, id: CommandId): boolean {
  const state = view.state;
  const ctx: Ctx = { view, state, dispatch: (tr) => view.dispatch(tr), options, texts: textsOf(state.doc) };
  if (id === 'table.sheet.documentKeys') {
    const spreadsheet = !sheetKeysKey.getState(state)?.spreadsheet;
    setSpreadsheet(ctx, spreadsheet);
    options.setKeys?.(spreadsheet ? 'spreadsheet' : 'document');
    options.announce(t(spreadsheet ? 'sheetKeys.announce.documentKeysOff' : 'sheetKeys.announce.documentKeysOn'));
    return true;
  }
  const mode = modeOf(state);
  const action = ACTIONS[id];
  return mode !== null && action !== undefined && action(ctx, mode);
}

/** Turns spreadsheet keys on or off, such as when another window changed the table's choice. */
export function setSheetKeys(view: EditorView, spreadsheet: boolean): void {
  if (sheetKeysKey.getState(view.state)?.spreadsheet === spreadsheet) return;
  const options: SheetKeysOptions = { spreadsheet, announce: () => {} };
  setSpreadsheet({ view, state: view.state, dispatch: (tr) => view.dispatch(tr), options, texts: [] }, spreadsheet);
}
