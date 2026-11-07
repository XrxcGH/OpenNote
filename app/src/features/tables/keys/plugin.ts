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
import { CellSelection } from '@tiptap/pm/tables';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
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
  gridOf,
  hasHeader,
  hasMerged,
  keysOn,
  modeOf,
  placedAt,
  selectCells,
  sheetKeysKey,
} from './state';
import type { SheetKeysOptions, SheetMeta, SheetState } from './state';
import styles from './keys.module.css';

export { activeCell, gridOf, modeOf, sheetKeysKey, textsOf } from './state';
export type { SheetKeysOptions, SheetMode } from './state';
export { dateText, runSheetCommand, setSheetKeys, timeText } from './actions';

// ---- Decorations and announcements

/**
 * aria-rowindex and aria-colindex on every cell, counted from 1. A merged cell takes its top left slot's. With
 * spreadsheet keys each cell is a "gridcell" or a "columnheader" of the grid that markGrid makes the table, so Grid
 * mode's aria-selected is allowed.
 */
function indexesOf(doc: PMNode, spreadsheet: boolean): DecorationSet {
  const decorations: Decoration[] = [];
  const done = new Set<number>();
  cellsOf(doc).forEach((row, r) =>
    row.forEach((cell, c) => {
      if (done.has(cell.pos)) return;
      done.add(cell.pos);
      const attrs: Record<string, string> = { 'aria-rowindex': String(r + 1), 'aria-colindex': String(c + 1) };
      if (spreadsheet) attrs.role = cell.node.type.name === 'tableHeader' ? 'columnheader' : 'gridcell';
      decorations.push(Decoration.node(cell.pos, cell.pos + cell.node.nodeSize, attrs));
    }),
  );
  return DecorationSet.create(doc, decorations);
}

/** Whether each step changed only the inside of one cell, so every cell keeps its row and column. */
export function insideOneCell(tr: Transaction): boolean {
  return tr.steps.every((step, i) => {
    const doc = tr.docs[i];
    let inside = true;
    step.getMap().forEach((from, to) => {
      if (!inside) return;
      const $from = doc.resolve(from);
      const $to = doc.resolve(to);
      // A cell's content sits at depth 3: the document, the table, the row, then the cell.
      inside = $from.depth >= 3 && $to.depth >= 3 && $from.start(3) === $to.start(3);
    });
    return inside;
  });
}

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
  if (next.spreadsheet !== value.spreadsheet || (tr.docChanged && !insideOneCell(tr)))
    next.indexes = indexesOf(state.doc, next.spreadsheet && !hasMerged(state.doc));
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
    if (at && !hasMerged(state.doc)) next.entry = { ...at, before: contentOf(state.doc, at), mode: 'edit' };
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
  const mode = modeOf(state);
  if (!mode) return sheet.indexes;
  const extra: Decoration[] = [];
  const mark = (at: GridCell, attrs: Record<string, string>) => {
    const cell = placedAt(state.doc, at);
    if (cell) extra.push(Decoration.node(cell.pos, cell.pos + cell.node.nodeSize, attrs));
  };
  const g = gridOf(state);
  if (g && sheet.focused) for (const at of cellsIn(g.box)) mark(at, { 'aria-selected': 'true' });
  const active = activeCell(state);
  if (active) mark(active, { class: mode === 'grid' ? styles.active : styles.editing });
  return sheet.indexes.add(state.doc, extra);
}

/** Notes when the editor gains or loses focus, so a cell isn't announced as selected while focus is elsewhere. */
function noteFocus(view: EditorView, focused: boolean): boolean {
  const sheet = sheetKeysKey.getState(view.state);
  if (!view.isDestroyed && sheet && sheet.focused !== focused)
    view.dispatch(view.state.tr.setMeta(sheetKeysKey, { focused } satisfies SheetMeta));
  return false;
}

/** A click on a cell's padding, not its text, selects the cell in Grid mode. */
function clickPadding(view: EditorView, event: MouseEvent): boolean {
  const target = event.target;
  if (!keysOn(view.state) || event.button !== 0 || event.shiftKey) return false;
  if (!(target instanceof HTMLTableCellElement) || !view.dom.contains(target)) return false;
  const at = cellOfPos(view.state.doc, view.posAtDOM(target, 0));
  const tr = at && selectCells(view.state, at);
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
  if (!table || (table.getAttribute('role') === 'grid') === on) return;
  if (on) table.setAttribute('role', 'grid');
  else table.removeAttribute('role');
}

/** Makes this table the one commands act on while it has focus, marks it a grid, and says each move. */
function sheetView(view: EditorView, options: SheetKeysOptions) {
  const runner: SheetRunner = {
    run: (command) => runSheetCommand(view, options, command),
    documentKeys: () => !keysOn(view.state),
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
        indexes: indexesOf(state.doc, options.spreadsheet && !hasMerged(state.doc)),
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
        mousedown: clickPadding,
        focus: (view) => noteFocus(view, true),
        blur: (view) => noteFocus(view, false),
      },
      attributes: scopeOf,
      decorations: decorationsOf,
    },
    view: (view) => sheetView(view, options),
  });
}
