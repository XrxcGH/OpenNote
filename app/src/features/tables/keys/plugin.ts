// Grid mode and Edit mode in a table block's editor (ADR 0063, DESIGN.md section 11). Grid mode is a cell
// selection: one active cell, or a range with the active cell inside it. Edit mode is the caret in a cell's text,
// as in a text editor. An entry started by typing over a cell, or by Backspace, is Enter mode: arrows finish it
// and move. Esc cancels an entry that F2, typing, or Backspace started, and puts the old text back.
//
// The plugin runs first among the editor's plugins. Chords a person may change come from the command registry
// (bindings.ts), so rebinding works; the navigation keys are fixed. A table set to document keys keeps today's
// keys: the plugin then only adds the cells' row and column numbers for screen readers.
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { onlyInsideCells } from '../../../editor/table/cellEdits';
import { t } from '../../../strings/t';
import { drawnRows, isVirtualDoc } from '../../page';
import { clearActiveSheet, setActiveSheet } from './active';
import type { SheetRunner } from './active';
import { cellsIn, runSheetCommand, shownText, typeOver } from './actions';
import { cellAnnouncement, rangeAnnouncement } from './announce';
import { address, boxSize } from './grid';
import type { GridCell } from './grid';
import { handleKey } from './keys';
import type { Ctx } from './moves';
import {
  activeCell,
  cellOfPos,
  cellsOf,
  contentOf,
  hasMerged,
  gridOf,
  hasHeader,
  keysOn,
  modeOf,
  placedAt,
  rowCells,
  selectCells,
  sheetKeysKey,
} from './state';
import type { Placed, SheetKeysOptions, SheetMeta, SheetState } from './state';
import styles from './keys.module.css';

export { activeCell, gridOf, modeOf, sheetKeysKey, textsOf } from './state';
export type { SheetKeysOptions, SheetMode } from './state';
export { dateText, runSheetCommand, setSheetKeys, timeText } from './actions';

// ---- Decorations and announcements

/** A cell number decoration's spec: the row it numbers. */
interface IndexSpec {
  readonly indexRow: number;
}

/**
 * aria-rowindex and aria-colindex on every cell of `rows`, counted from 1. A merged cell takes its top left slot's.
 * With spreadsheet keys each cell is a "gridcell" or a "columnheader" of the grid that markGrid makes the table, so
 * Grid mode's aria-selected is allowed. Without the whole grid (`all`), each row is read on its own.
 */
function indexDecorations(
  doc: PMNode,
  spreadsheet: boolean,
  rows: readonly number[],
  all: readonly (readonly Placed[])[] | null,
): Decoration[] {
  const decorations: Decoration[] = [];
  const done = new Set<number>();
  rows.forEach((r) =>
    (all ? all[r] : rowCells(doc, r))?.forEach((cell, c) => {
      if (done.has(cell.pos)) return;
      done.add(cell.pos);
      const attrs: Record<string, string> = { 'aria-rowindex': String(r + 1), 'aria-colindex': String(c + 1) };
      if (spreadsheet) attrs.role = cell.node.type.name === 'tableHeader' ? 'columnheader' : 'gridcell';
      const spec: IndexSpec = { indexRow: r };
      decorations.push(Decoration.node(cell.pos, cell.pos + cell.node.nodeSize, attrs, spec));
    }),
  );
  return decorations;
}

/** The cell numbers on every cell, or on the rows `only`: a long table never builds its whole grid for one screen. */
function indexesOf(doc: PMNode, spreadsheet: boolean, only?: readonly number[]): DecorationSet {
  const all = only ? null : cellsOf(doc);
  return DecorationSet.create(doc, indexDecorations(doc, spreadsheet, only ?? all!.map((_, r) => r), all));
}

interface DrawnIndexes {
  readonly spreadsheet: boolean;
  /** The drawn rows the set numbers, or null for every row. */
  readonly rows: readonly number[] | null;
  readonly key: string;
  readonly set: DecorationSet;
}

/**
 * The cell numbers of a virtual table (more than 2,000 rows): only on the rows it draws, made once per document. A
 * change inside one cell maps the last document's numbers (mapDrawnIndexes). A window move numbers only the rows
 * that come, and drops the rows that go (movedIndexes). Making a whole set walks every row of the table.
 */
const drawnIndexes = new WeakMap<PMNode, DrawnIndexes>();

/** Carries a virtual table's cell numbers through a change inside one cell, so a key never makes them again. */
function mapDrawnIndexes(tr: Transaction): void {
  if (!tr.docChanged || drawnIndexes.has(tr.doc)) return;
  const known = drawnIndexes.get(tr.before);
  if (known && insideOneCell(tr)) drawnIndexes.set(tr.doc, { ...known, set: known.set.map(tr.mapping, tr.doc) });
}

/** The cell numbers after the window moved from `known.rows` to `rows`, or null when they must be made again. */
function movedIndexes(doc: PMNode, known: DrawnIndexes, spreadsheet: boolean, rows: readonly number[]) {
  if (known.spreadsheet !== spreadsheet || !known.rows || hasMerged(doc)) return null;
  const was = new Set(known.rows);
  const now = new Set(rows);
  const gone = known.set.find(undefined, undefined, (spec: Partial<IndexSpec>) => !now.has(spec.indexRow ?? -1));
  const come = rows.filter((r) => !was.has(r));
  return known.set.remove(gone).add(doc, indexDecorations(doc, spreadsheet, come, null));
}

function indexesFor(state: EditorState, sheet: SheetState): DecorationSet {
  if (!isVirtualDoc(state.doc)) return sheet.indexes;
  const rows = drawnRows(state);
  const key = `${sheet.spreadsheet}:${rows ? rows.join(',') : 'all'}`;
  const known = drawnIndexes.get(state.doc);
  if (known?.key === key) return known.set;
  const set =
    (known && rows && movedIndexes(state.doc, known, sheet.spreadsheet, rows)) ??
    indexesOf(state.doc, sheet.spreadsheet, rows ?? undefined);
  drawnIndexes.set(state.doc, { spreadsheet: sheet.spreadsheet, rows, key, set });
  return set;
}

/** Whether each step changed only the inside of one cell, so every cell keeps its row and column. */
export const insideOneCell = (tr: Transaction): boolean => onlyInsideCells(tr);

/** What a screen reader hears when the active cell or the range changes. */
function speech(view: EditorView, options: SheetKeysOptions): string | null {
  const g = gridOf(view.state);
  if (!g) return null;
  const header = hasHeader(view.state.doc);
  if (boxSize(g.box) > 1 && g.active.row === g.anchor.row && g.active.column === g.anchor.column)
    return rangeAnnouncement(
      address({ row: g.box.top, column: g.box.left }, header),
      address({ row: g.box.bottom, column: g.box.right }, header),
      boxSize(g.box),
    );
  const text = placedAt(view.state.doc, g.active)?.node.textContent ?? '';
  const isFormula = text.trim().startsWith('=');
  return cellAnnouncement({
    address: address(g.active, header),
    header: header ? (placedAt(view.state.doc, { row: 0, column: g.active.column })?.node.textContent ?? null) : null,
    shown: isFormula ? shownText(view, options, g.active) : text,
    formula: isFormula ? text.trim() : null,
    isHeader: header && g.active.row === 0,
  });
}

/** The key of what was announced: the range and the active cell. */
function spoken(state: EditorState): string | null {
  const g = gridOf(state);
  return g ? `${g.box.top},${g.box.left},${g.box.bottom},${g.box.right}:${g.active.row},${g.active.column}` : null;
}

/** The plugin state after a transaction: meta from the actions, and an entry that ends when the caret leaves. */
function applyMeta(tr: Transaction, value: SheetState, state: EditorState): SheetState {
  const meta = tr.getMeta(sheetKeysKey) as SheetMeta | undefined;
  const next: SheetState = { ...value };
  if (meta?.spreadsheet !== undefined) next.spreadsheet = meta.spreadsheet;
  if (meta?.focused !== undefined) next.focused = meta.focused;
  // Typing maps the cells' numbers through the change, so a keystroke costs the same in a big table as in a small one.
  // A virtual table numbers only the rows it draws, when the editor draws them (indexesFor).
  if (isVirtualDoc(state.doc)) {
    next.indexes = DecorationSet.empty;
    mapDrawnIndexes(tr);
  } else if (next.spreadsheet !== value.spreadsheet || (tr.docChanged && !insideOneCell(tr)))
    next.indexes = indexesOf(state.doc, next.spreadsheet);
  else if (tr.docChanged) next.indexes = value.indexes.map(tr.mapping, tr.doc);
  if (meta && 'active' in meta) next.active = meta.active ?? null;
  else if (tr.selectionSet) next.active = null;
  if (meta && 'entry' in meta) next.entry = meta.entry ?? null;
  else if (next.entry) {
    const at = state.selection instanceof CellSelection ? null : cellOfPos(state.doc, state.selection.head);
    if (!at || at.row !== next.entry.row || at.column !== next.entry.column) next.entry = null;
  }
  // A click or Tab that puts the caret in a cell starts an Edit mode entry, so Esc puts the cell's text back.
  if (
    !next.entry &&
    tr.selectionSet &&
    !tr.docChanged &&
    next.spreadsheet &&
    state.selection instanceof TextSelection
  ) {
    const at = cellOfPos(state.doc, state.selection.head);
    if (at) next.entry = { ...at, before: contentOf(state.doc, at), mode: 'edit' };
  }
  return next;
}

/**
 * The cell numbers on every cell; in Grid mode the range's aria-selected while the editor has focus; and the active
 * cell's outline.
 */
function decorationsOf(state: EditorState): DecorationSet | null {
  const sheet = sheetKeysKey.getState(state);
  if (!sheet) return null;
  const indexes = indexesFor(state, sheet);
  const mode = modeOf(state);
  if (!mode) return indexes;
  const extra: Decoration[] = [];
  const mark = (at: GridCell, attrs: Record<string, string>) => {
    const cell = placedAt(state.doc, at);
    if (cell) extra.push(Decoration.node(cell.pos, cell.pos + cell.node.nodeSize, attrs));
  };
  const g = gridOf(state);
  if (g && sheet.focused) {
    // A long table marks only the rows it draws: a range of thousands of rows stays as fast as one screen of them.
    const drawn = drawnRows(state);
    if (!drawn) for (const at of cellsIn(g.box)) mark(at, { 'aria-selected': 'true' });
    else
      for (const row of drawn)
        if (row >= g.box.top && row <= g.box.bottom)
          for (let column = g.box.left; column <= g.box.right; column += 1)
            mark({ row, column }, { 'aria-selected': 'true' });
  }
  const active = activeCell(state);
  if (active) mark(active, { class: mode === 'grid' ? styles.active : styles.editing });
  return indexes.add(state.doc, extra);
}

/** Notes when the editor gains or loses focus, so a cell isn't announced as selected while focus is elsewhere. */
function noteFocus(view: EditorView, focused: boolean): boolean {
  const sheet = sheetKeysKey.getState(view.state);
  if (!view.isDestroyed && sheet && sheet.focused !== focused)
    view.dispatch(view.state.tr.setMeta(sheetKeysKey, { focused } satisfies SheetMeta));
  return false;
}

/**
 * A click on a cell's padding, not its text, selects the cell in Grid mode. So does one click on the text of a cell
 * that shows more than it holds, as a formula shows its result. A caret there would show the raw formula, and a typed
 * key would add to it. A double click, or F2, edits the formula.
 */
function clickPadding(view: EditorView, event: MouseEvent, options: SheetKeysOptions): boolean {
  const target = event.target;
  if (!keysOn(view.state) || event.button !== 0 || event.shiftKey || !(target instanceof Element)) return false;
  const cell = target.closest('td, th');
  if (!(cell instanceof HTMLTableCellElement) || !view.dom.contains(cell)) return false;
  const at = cellOfPos(view.state.doc, view.posAtDOM(cell, 0));
  if (!at) return false;
  if (target !== cell && (event.detail > 1 || shownText(view, options, at) === (cell.textContent ?? ''))) return false;
  const tr = selectCells(view.state, at);
  if (!tr) return false;
  event.preventDefault();
  view.focus();
  view.dispatch(tr);
  return true;
}

/** The mode's key scope on the editor, so the app's key handler finds Grid mode's and Edit mode's commands. */
function scopeOf(state: EditorState): Record<string, string> {
  const mode = modeOf(state);
  const scope = mode === 'grid' ? ' tableGrid' : mode === 'edit' ? ' tableEdit' : '';
  return { 'data-scope': `editor editor.table${scope}` };
}

/**
 * role="grid" on the table element with spreadsheet keys. The table's node view draws the element, so a node
 * decoration would land on its wrapper; the view ignores attribute changes on the element.
 */
function markGrid(view: EditorView, on: boolean): void {
  const table = view.dom.querySelector('table');
  if (!table) return;
  if (!on) {
    for (const name of ['role', 'aria-label', 'aria-rowcount', 'aria-colcount']) table.removeAttribute(name);
    return;
  }
  // The grid has a name and says its size, so a screen reader reads "Table, 3 rows by 2 columns" (walk 9 T4-D07-12).
  const node = view.state.doc.firstChild;
  const rows = node?.childCount ?? 0;
  const columns = node ? TableMap.get(node).width : 0;
  const set = (name: string, value: string) => {
    if (table.getAttribute(name) !== value) table.setAttribute(name, value);
  };
  set('role', 'grid');
  set('aria-label', t('sheetKeys.grid.label', { rows, columns }));
  set('aria-rowcount', String(rows));
  set('aria-colcount', String(columns));
}

const FILL_ENTRY = 'table.sheet.fillEntry';

/** Whether the grid selection is one cell, so fill entry has nothing to fill. */
function singleCell(state: EditorState): boolean {
  const box = gridOf(state)?.box;
  return box !== undefined && box.top === box.bottom && box.left === box.right;
}

/** Makes this table the one commands act on while it has focus, marks it a grid, and says each move. */
function sheetView(view: EditorView, options: SheetKeysOptions) {
  const runner: SheetRunner = {
    run: (command) => runSheetCommand(view, options, command),
    documentKeys: () => !keysOn(view.state),
    canRun: (command) => command !== FILL_ENTRY || !singleCell(view.state),
  };
  const focus = () => setActiveSheet(runner);
  view.dom.addEventListener('focusin', focus);
  if (view.hasFocus()) {
    focus();
    // The state starts unfocused. Note focus after this update, since a view can't dispatch while it updates.
    queueMicrotask(() => noteFocus(view, view.hasFocus()));
  }
  markGrid(view, keysOn(view.state));
  let said = spoken(view.state);
  return {
    update(next: EditorView) {
      markGrid(next, keysOn(next.state));
      const now = spoken(next.state);
      if (now === said) return;
      said = now;
      const text = now === null ? null : speech(next, options);
      if (text) options.announce(text);
    },
    destroy() {
      markGrid(view, false);
      view.dom.removeEventListener('focusin', focus);
      clearActiveSheet(runner);
    },
  };
}

export function sheetKeysPlugin(options: SheetKeysOptions): Plugin<SheetState> {
  return new Plugin<SheetState>({
    key: sheetKeysKey,
    state: {
      init: (_config, state) => ({
        spreadsheet: options.spreadsheet,
        entry: null,
        active: null,
        indexes: isVirtualDoc(state.doc) ? DecorationSet.empty : indexesOf(state.doc, options.spreadsheet),
        focused: false,
      }),
      apply: (tr, value, _old, state) => applyMeta(tr, value, state),
    },
    props: {
      handleKeyDown: (view, event) => handleKey(view, event, options),
      handleTextInput(view, _from, _to, text) {
        // Text that arrives without a key press, such as from a phone keyboard, types over the cell too.
        if (modeOf(view.state) !== 'grid') return false;
        const ctx: Ctx = { view, state: view.state, dispatch: (tr) => view.dispatch(tr), options, texts: [] };
        return typeOver(ctx, text);
      },
      handleDOMEvents: {
        mousedown: (view, event) => clickPadding(view, event, options),
        focus: (view) => noteFocus(view, true),
        blur: (view) => noteFocus(view, false),
      },
      attributes: scopeOf,
      decorations: decorationsOf,
    },
    view: (view) => sheetView(view, options),
  });
}
