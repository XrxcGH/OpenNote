// The grid side of a formula being typed, in the cell or in the formula bar. Each reference's cells get an outline in
// the reference's color. A click or drag on the grid inserts a reference at the caret. F4 cycles the "$" marks of
// the reference at the caret in the cell. The bar tells the plugin its text with a meta. While its entry has focus,
// it lends the plugin a picker, so a click on the grid lands in the bar's formula.
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { cellOfPos, cellsOf, hasHeader, textRange } from '../../keys/state';
import type { GridCell } from '../../keys/grid';
import { canPick, coloredRefs, cycleAnchor, gridRange, insertRef, refCells } from './refs';
import { scanFormula } from './scan';
import styles from './formulaBar.module.css';

/** At most this many cells get an outline, so a reference to a whole large table stays cheap. */
const OUTLINE_CAP = 2000;

interface RefsState {
  /** The bar's formula while its entry has focus, or null. */
  bar: string | null;
  /** The span the last pick in the cell wrote, so a drag or a second click replaces it. */
  picked: { start: number; end: number } | null;
  outlines: DecorationSet;
}

interface RefsMeta {
  bar?: string | null;
  picked?: { start: number; end: number } | null;
}

export const formulaRefsKey = new PluginKey<RefsState>('opennote.formulaRefs');

/** What the bar lends the plugin while its entry has focus. */
export interface BarPicker {
  /** True when a click on the grid should insert a reference into the bar's formula now. */
  canPick(): boolean;
  /** Puts a reference in the bar's formula. `first` is true for the click, false for each step of a drag after it. */
  pick(ref: string, first: boolean): void;
}

const pickers = new WeakMap<EditorView, BarPicker>();

export function setBarPicker(view: EditorView, picker: BarPicker | null): void {
  if (picker) pickers.set(view, picker);
  else pickers.delete(view);
}

/** Tells the plugin the bar's formula (null when the bar's entry lets go), so the grid outlines its references. */
export function showBarFormula(view: EditorView, text: string | null): void {
  if (view.isDestroyed) return;
  view.dispatch(view.state.tr.setMeta(formulaRefsKey, { bar: text } satisfies RefsMeta).setMeta('addToHistory', false));
}

/** The cell with the caret, its text, and the caret's place in the text, when the caret is in a cell. */
function editedCell(state: EditorState): { at: GridCell; from: number; text: string; offset: number } | null {
  if (!(state.selection instanceof TextSelection)) return null;
  const at = cellOfPos(state.doc, state.selection.head);
  if (!at) return null;
  const placed = cellsOf(state.doc)[at.row]?.[at.column];
  if (!placed) return null;
  const { from, to } = textRange(placed);
  const text = state.doc.textBetween(from, to, '\n');
  return { at, from, text, offset: state.selection.head - from };
}

/** The outlines of a formula's references on the table's cells. */
function outlinesOf(state: EditorState, text: string | null): DecorationSet {
  if (!text?.startsWith('=')) return DecorationSet.empty;
  const refs = coloredRefs(scanFormula(text));
  if (refs.length === 0) return DecorationSet.empty;
  const grid = cellsOf(state.doc);
  const header = hasHeader(state.doc);
  const decorations: Decoration[] = [];
  const done = new Set<number>();
  for (const { token, color } of refs) {
    const box = refCells(token, header);
    if (!box) continue;
    for (let r = box.top; r <= box.bottom && r < grid.length; r += 1) {
      for (let c = box.left; c <= box.right; c += 1) {
        const placed = grid[r]?.[c];
        if (!placed || done.has(placed.pos) || done.size >= OUTLINE_CAP) continue;
        done.add(placed.pos);
        const edges = `${r === box.top ? 't' : ''}${c === box.right ? 'r' : ''}${r === box.bottom ? 'b' : ''}${c === box.left ? 'l' : ''}`;
        decorations.push(
          Decoration.node(placed.pos, placed.pos + placed.node.nodeSize, {
            class: styles.refCell ?? '',
            'data-formula-ref': String(color),
            'data-formula-ref-edges': edges,
          }),
        );
      }
    }
  }
  return DecorationSet.create(state.doc, decorations);
}

/** The grid cell under a point of the page inside this editor, or null. */
function cellAtPoint(view: EditorView, x: number, y: number): GridCell | null {
  const element = document.elementFromPoint(x, y)?.closest('td, th');
  if (!element || !view.dom.contains(element)) return null;
  try {
    return cellOfPos(view.state.doc, view.posAtDOM(element, 0));
  } catch {
    return null;
  }
}

/** Follows the pointer until it lets go, calling `move` with each new cell under it. */
function followDrag(view: EditorView, move: (cell: GridCell) => void): void {
  let last = '';
  const onMove = (event: MouseEvent) => {
    const cell = cellAtPoint(view, event.clientX, event.clientY);
    const key = cell ? `${cell.row}:${cell.column}` : '';
    if (cell && key !== last) {
      last = key;
      move(cell);
    }
  };
  const stop = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', stop);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', stop);
}

/** Writes a reference at the caret of the cell being edited, or in place of the last pick. */
function pickInCell(view: EditorView, ref: string): void {
  const state = view.state;
  const edited = editedCell(state);
  if (!edited) return;
  const picked = formulaRefsKey.getState(state)?.picked ?? undefined;
  const next = insertRef(edited.text, edited.offset, ref, picked);
  const start = edited.from + (picked?.start ?? edited.offset);
  const end = edited.from + (picked?.end ?? edited.offset);
  const tr = state.tr.insertText(ref, start, end);
  tr.setSelection(TextSelection.create(tr.doc, edited.from + next.caret));
  view.dispatch(tr.setMeta(formulaRefsKey, { picked: next.picked } satisfies RefsMeta));
}

/**
 * A press on the grid while a formula is typed: inserts a reference and follows a drag. The table extra listens in
 * the capture phase, before the editor and the table plugins see the press, and stops it when it inserts.
 */
export function pickOnPress(view: EditorView, event: MouseEvent): boolean {
  if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return false;
  const target = cellAtPoint(view, event.clientX, event.clientY);
  if (!target) return false;
  const header = hasHeader(view.state.doc);
  const picker = pickers.get(view);
  if (picker?.canPick()) {
    const ref = gridRange(target, target, header);
    if (!ref) return false;
    event.preventDefault();
    picker.pick(ref, true);
    followDrag(view, (cell) => {
      const range = gridRange(target, cell, header);
      if (range) picker.pick(range, false);
    });
    return true;
  }
  const edited = editedCell(view.state);
  if (!edited || (edited.at.row === target.row && edited.at.column === target.column)) return false;
  const picking = formulaRefsKey.getState(view.state)?.picked;
  if (!picking && !canPick(edited.text, edited.offset)) return false;
  const ref = gridRange(target, target, header);
  if (!ref) return false;
  event.preventDefault();
  pickInCell(view, ref);
  followDrag(view, (cell) => {
    const range = gridRange(target, cell, header);
    if (range) pickInCell(view, range);
  });
  return true;
}

function onKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'F4' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
  const edited = editedCell(view.state);
  if (!edited?.text.startsWith('=')) return false;
  const cycled = cycleAnchor(edited.text, edited.offset);
  if (!cycled) return false;
  const tr = view.state.tr.insertText(cycled.text, edited.from, edited.from + edited.text.length);
  tr.setSelection(TextSelection.create(tr.doc, edited.from + cycled.caret));
  view.dispatch(tr);
  return true;
}

/** The plugin that draws a formula's reference outlines and inserts picked references. */
export function formulaRefsPlugin(): Plugin<RefsState> {
  return new Plugin<RefsState>({
    key: formulaRefsKey,
    state: {
      init: (_, state) => ({ bar: null, picked: null, outlines: outlinesOf(state, editedCell(state)?.text ?? null) }),
      apply(tr: Transaction, old: RefsState, _before: EditorState, state: EditorState): RefsState {
        const meta = tr.getMeta(formulaRefsKey) as RefsMeta | undefined;
        if (!meta && !tr.docChanged && !tr.selectionSet) return old;
        const bar = meta && 'bar' in meta ? (meta.bar ?? null) : old.bar;
        // A pick lasts until something else changes the cell or moves the caret.
        const picked = meta && 'picked' in meta ? (meta.picked ?? null) : null;
        const text = bar ?? editedCell(state)?.text ?? null;
        return { bar, picked, outlines: outlinesOf(state, text) };
      },
    },
    props: {
      decorations: (state) => formulaRefsKey.getState(state)?.outlines ?? DecorationSet.empty,
      handleKeyDown: onKeyDown,
    },
  });
}
