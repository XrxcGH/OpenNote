// Row virtualization in a table block's editor (DESIGN.md section 18). A table of more than 2,000 rows draws one
// run of rows near the view: the window. Every other row is a placeholder, an empty comment node. The browser never
// styles or lays out a comment, so moving the window costs only the rows that come and go. Padding above and below
// the table stands in for the rows outside the window, at the heights they had when last drawn.
//
// ProseMirror's document stays whole, so commands, undo, sync, and the spreadsheet keys see every row. Tables of
// 2,000 rows or fewer get exactly the DOM they had before.
//
// A node view per row decides between the row and its placeholder, by whether the row is in the window. When the
// window moves, the plugin marks the rows that come and go with a node decoration. The mark says what the row
// becomes. Only those rows are drawn again, so typing and moving the caret cost nothing here.
//
// The window follows the page's scrolling. It moves to the row of the selection's head, so the caret is always in a
// drawn row. Screen readers hear the table's row count (aria-rowcount) and each drawn row's number
// (aria-rowindex). Placeholders are not in their tree.
import { DOMSerializer } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import { FIRST_WINDOW_ROWS, isVirtualCount, isVirtualDoc, nextWindow, rowAt, tableOf, visibleRows } from './rows';
import type { RowWindow } from './rows';
import { virtualRowsKey } from './key';
import type { VirtualRowsState } from './key';
import styles from './virtual.module.css';

interface Meta {
  window?: RowWindow;
  rowHeight?: number;
}

/** A mark's spec: whether the row is drawn, and its index. */
interface RowMark {
  readonly vrow: boolean;
  readonly row: number;
  readonly n: number;
}

/** The fewest rows the window keeps on each side of the visible ones. */
const MIN_MARGIN = 20;
/** How tall a row counts before any row is measured, in the table's font size. */
const FALLBACK_EMS = 2.25;

/** Each row's height when it was last drawn, by row node, so the padding keeps the rows' places. */
const rowHeights = new WeakMap<PMNode, number>();

/** The editor of each virtual table's editable root, for the find and reveal helpers. */
const views = new WeakMap<Element, EditorView>();

/** Where each row of a table block's document starts, and where the last one ends, made once per document. */
const starts = new WeakMap<PMNode, Int32Array>();

function startsOf(doc: PMNode): Int32Array {
  let at = starts.get(doc);
  if (at) return at;
  const table = tableOf(doc);
  const count = table?.childCount ?? 0;
  at = new Int32Array(count + 1);
  // The table starts at 0, so its first row starts at 1.
  at[0] = 1;
  for (let i = 0; i < count; i++) at[i + 1] = at[i] + table!.child(i).nodeSize;
  starts.set(doc, at);
  return at;
}

/** The index of the row that starts at `pos`, by binary search over the row starts, or null. */
function rowStartingAt(doc: PMNode, pos: number): number | null {
  const at = startsOf(doc);
  let lo = 0;
  let hi = at.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (at[mid] === pos) return mid;
    if (at[mid] < pos) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/** The window, moved so it holds row `row` when it does not, keeping its size. */
function around(window: RowWindow, row: number, rows: number): RowWindow {
  if (row >= window.from && row < window.to) return window;
  const half = Math.max(MIN_MARGIN, Math.ceil((window.to - window.from) / 2));
  return { from: Math.max(0, row - half), to: Math.min(rows, row + half) };
}

const inWindow = (window: RowWindow, row: number) => row >= window.from && row < window.to;

function build(
  state: EditorState,
  prev: VirtualRowsState | null,
  tr?: Transaction,
  old?: EditorState,
  meta?: Meta,
): VirtualRowsState {
  const rows = tableOf(state.doc)?.childCount ?? 0;
  const virtual = isVirtualCount(rows);
  const wanted = meta?.window ?? prev?.window ?? { from: 0, to: FIRST_WINDOW_ROWS };
  let window: RowWindow = { from: Math.min(wanted.from, rows), to: Math.min(wanted.to, rows) };
  // A selection or an edit moves the window to the selection's head, so the caret is always in a drawn row.
  const head = rowAt(state.doc, state.selection.head);
  if (virtual && head !== null && (!tr || tr.selectionSet || tr.docChanged) && !meta?.window)
    window = around(window, head, rows);
  const rowHeight = meta?.rowHeight ?? prev?.rowHeight ?? null;
  // The rows whose part may have changed, by index in the new document.
  const changed = new Set<number>();
  if (!prev) {
    // The first view drew a virtual table's rows as placeholders: the window's rows are drawn now.
    if (virtual) for (let i = window.from; i < window.to; i++) changed.add(i);
  } else if (prev.virtual !== virtual) {
    // Crossing the threshold: every row draws itself or its placeholder.
    for (let i = 0; i < rows; i++) changed.add(i);
  } else if (!virtual) {
    return { ...prev, rows, window, rowHeight, decorations: DecorationSet.empty };
  } else if (prev.rows === rows) {
    if (prev.window.from === window.from && prev.window.to === window.to) {
      const decorations = tr?.docChanged ? prev.decorations.map(tr.mapping, tr.doc) : prev.decorations;
      return { ...prev, rowHeight, decorations };
    }
    for (let i = Math.min(prev.window.from, window.from); i < Math.max(prev.window.to, window.to); i++)
      if (inWindow(prev.window, i) !== inWindow(window, i)) changed.add(i);
  } else {
    // Rows came or went: the rows drawn before, wherever they are now, and the window's rows get new marks, so each
    // knows its part and its number.
    const before = old ? startsOf(old.doc) : null;
    for (let i = prev.window.from; before && tr && i < prev.window.to && i + 1 < before.length; i++) {
      const mapped = tr.mapping.mapResult(before[i] + 1);
      if (mapped.deleted) continue;
      const row = rowAt(state.doc, mapped.pos);
      if (row !== null) changed.add(row);
    }
    for (let i = window.from; i < window.to; i++) changed.add(i);
  }
  const marks = (prev?.marks ?? 0) + 1;
  const at = startsOf(state.doc);
  const decorations: Decoration[] = [];
  for (const i of changed) {
    if (i < 0 || i >= rows) continue;
    const spec: RowMark = { vrow: !virtual || inWindow(window, i), row: i, n: marks };
    // No attributes: a placeholder comment could not carry them. The spec makes the mark new.
    decorations.push(Decoration.node(at[i], at[i + 1], {}, spec));
  }
  return {
    rows,
    virtual,
    window,
    rowHeight,
    marks,
    decorations: decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty,
  };
}

/** A row's mark among its decorations, if the last change marked it. */
function markOf(decorations: readonly Decoration[]): RowMark | null {
  for (const d of decorations) if (typeof (d.spec as Partial<RowMark>).vrow === 'boolean') return d.spec as RowMark;
  return null;
}

/** Whether a node of the table body is a row's placeholder. */
export function isPlaceholder(node: Node | null | undefined): boolean {
  return node?.nodeType === 8;
}

function sameAttrs(a: PMNode, b: PMNode): boolean {
  const keys = Object.keys(a.attrs);
  return keys.length === Object.keys(b.attrs).length && keys.every((key) => a.attrs[key] === b.attrs[key]);
}

/** A table row: the row as the schema draws it, or a placeholder comment. */
export class RowView implements NodeView {
  /** The row's element, or its placeholder comment (typed as an element, as the node view type asks). */
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement | null = null;
  private readonly drawn: boolean;
  private node: PMNode;

  constructor(
    node: PMNode,
    private readonly view: EditorView,
    getPos: () => number | undefined,
    decorations: readonly Decoration[],
  ) {
    this.node = node;
    const { state } = view;
    const own = virtualRowsKey.getState(state);
    const mark = markOf(decorations);
    // While a row view is made, its position is known at once; the row's index comes from the cached row starts.
    const pos = own?.virtual && !mark ? getPos() : undefined;
    const row = mark?.row ?? (pos === undefined ? null : rowStartingAt(state.doc, pos));
    if (mark) this.drawn = mark.vrow;
    else if (own) this.drawn = !own.virtual || (row !== null && inWindow(own.window, row));
    // Tiptap draws an editor's first view before any plugin is in: a virtual table's rows start as placeholders,
    // and the plugin's first marks draw the window's rows right after.
    else this.drawn = state.plugins.length > 0 || !isVirtualDoc(state.doc);
    const doc = view.dom.ownerDocument;
    if (this.drawn) {
      const spec = node.type.spec.toDOM?.(node);
      const out = spec ? DOMSerializer.renderSpec(doc, spec) : { dom: doc.createElement('tr'), contentDOM: undefined };
      this.dom = out.dom as HTMLElement;
      this.contentDOM = (out.contentDOM ?? out.dom) as HTMLElement;
      if (own?.virtual && row !== null) this.contentDOM.setAttribute('aria-rowindex', String(row + 1));
      return;
    }
    // A comment, so the browser never styles or lays it out: the table's padding holds its place. ProseMirror asks a
    // leaf view's element whether it sets contenteditable; a comment answers that it does, so nothing is set on it.
    const placeholder = doc.createComment('row');
    Object.defineProperty(placeholder, 'hasAttribute', { value: () => true });
    this.dom = placeholder as unknown as HTMLElement;
  }

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false;
    const mark = markOf(decorations);
    if (mark && mark.vrow !== this.drawn) return false;
    // A drawn row's attributes are in its DOM; a new set draws the row again.
    if (this.drawn && !sameAttrs(node, this.node)) return false;
    if (mark && this.contentDOM) {
      if (virtualRowsKey.getState(this.view.state)?.virtual)
        this.contentDOM.setAttribute('aria-rowindex', String(mark.row + 1));
      else this.contentDOM.removeAttribute('aria-rowindex');
    }
    this.node = node;
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return !this.drawn && mutation.type !== 'selection';
  }
}

/** The scrolling elements around the editor that clip what shows, nearest first. */
function clipsOf(dom: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const win = dom.ownerDocument.defaultView;
  for (let at = dom.parentElement; at && at !== dom.ownerDocument.body; at = at.parentElement) {
    const overflow = win?.getComputedStyle(at).overflowY;
    if (overflow && overflow !== 'visible') out.push(at);
  }
  return out;
}

function nextFrame(win: Window | null, run: () => void): () => void {
  if (win?.requestAnimationFrame) {
    const id = win.requestAnimationFrame(run);
    return () => win.cancelAnimationFrame(id);
  }
  const id = setTimeout(run, 16);
  return () => clearTimeout(id);
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Watches the page's scrolling and moves the window, at most once a frame, and keeps the padding that stands in
 * for the rows outside the window.
 */
class Watcher {
  private cancel: (() => void) | null = null;
  private clips: HTMLElement[] | null = null;
  private readonly win: Window | null;
  /** Each row's top from the first row's top, and the total at the end, for the document they were made from. */
  private offsets: { doc: PMNode; typical: number; at: Float64Array } | null = null;

  constructor(private readonly view: EditorView) {
    views.set(view.dom, view);
    this.win = view.dom.ownerDocument.defaultView;
    view.dom.ownerDocument.addEventListener('scroll', this.schedule, { capture: true, passive: true });
    this.win?.addEventListener('resize', this.resized, { passive: true });
    this.markTable();
    this.schedule();
  }

  private readonly resized = () => {
    this.clips = null;
    this.schedule();
  };

  readonly schedule = () => {
    if (this.cancel) return;
    this.cancel = nextFrame(this.win, () => {
      this.cancel = null;
      this.measure();
    });
  };

  update(view: EditorView, prev: EditorState): void {
    const state = virtualRowsKey.getState(view.state);
    if (view.state.doc === prev.doc && state === virtualRowsKey.getState(prev)) return;
    this.markTable();
    this.schedule();
  }

  /** How tall a row never measured counts, in CSS pixels. */
  private typical(table: HTMLElement | null): number {
    const state = virtualRowsKey.getState(this.view.state);
    if (state?.rowHeight) return state.rowHeight;
    const size = table && this.win ? parseFloat(this.win.getComputedStyle(table).fontSize) : NaN;
    return (Number.isFinite(size) ? size : 16) * FALLBACK_EMS;
  }

  /** Row tops from the first row's top: measured heights where known, the typical height elsewhere. */
  private offsetsFor(typical: number): Float64Array {
    const { doc } = this.view.state;
    if (this.offsets?.doc === doc && this.offsets.typical === typical) return this.offsets.at;
    const table = tableOf(doc);
    const count = table?.childCount ?? 0;
    const at = new Float64Array(count + 1);
    for (let i = 0; i < count; i++) at[i + 1] = at[i] + (rowHeights.get(table!.child(i)) ?? typical);
    this.offsets = { doc, typical, at };
    return at;
  }

  /**
   * Sets the row count for screen readers on the <table>; the table's node view ignores it. Sets the heights of the
   * rows above and below the window on the element around the editor, for the padding of virtual.module.css.
   */
  private markTable(): void {
    const state = virtualRowsKey.getState(this.view.state);
    const table = this.view.dom.querySelector('table');
    const host = this.view.dom.parentElement;
    if (!state || !table || !host) return;
    if (!state.virtual) {
      if (!table.hasAttribute('data-virtual-rows')) return;
      table.removeAttribute('aria-rowcount');
      table.removeAttribute('data-virtual-rows');
      host.classList.remove(styles.host);
      host.style.removeProperty('--opennote-vrows-above');
      host.style.removeProperty('--opennote-vrows-below');
      return;
    }
    const count = String(state.rows);
    if (table.getAttribute('aria-rowcount') !== count) table.setAttribute('aria-rowcount', count);
    if (!table.hasAttribute('data-virtual-rows')) table.setAttribute('data-virtual-rows', '');
    host.classList.add(styles.host);
    const at = this.offsetsFor(this.typical(table));
    host.style.setProperty('--opennote-vrows-above', `${at[state.window.from]}px`);
    host.style.setProperty('--opennote-vrows-below', `${at[state.rows] - at[state.window.to]}px`);
  }

  private measure(): void {
    const { view } = this;
    const state = virtualRowsKey.getState(view.state);
    if (!state?.virtual || view.isDestroyed || !view.dom.isConnected) return;
    if (view.composing) return this.schedule();
    const doc = tableOf(view.state.doc);
    const table = view.dom.querySelector('table');
    const rows = table?.querySelector('tbody')?.childNodes;
    if (!doc || !table || !rows || rows.length !== state.rows) return;
    const { from, to } = state.window;
    // The drawn rows' heights, so they keep their places once they leave the window.
    const heights: number[] = [];
    let changed = false;
    for (let i = from; i < to; i++) {
      const row = rows[i];
      if (!(row instanceof Element)) continue;
      const height = row.getBoundingClientRect().height;
      if (height <= 0) continue;
      const node = doc.child(i);
      if (rowHeights.get(node) !== height) {
        rowHeights.set(node, height);
        changed = true;
      }
      heights.push(height);
    }
    if (changed) this.offsets = null;
    const meta: Meta = {};
    if (heights.length > 0) {
      const typical = Math.round(median(heights) * 100) / 100;
      if (state.rowHeight === null || Math.abs(typical - state.rowHeight) > 0.5) meta.rowHeight = typical;
    }
    const at = this.offsetsFor(meta.rowHeight ?? this.typical(table));
    // Where the first row would be: the window's first drawn row, less the rows above it.
    const anchor = rows[from];
    const origin =
      anchor instanceof Element ? anchor.getBoundingClientRect().top - at[from] : table.getBoundingClientRect().top;
    let top = 0;
    let bottom = this.win?.innerHeight ?? 0;
    this.clips ??= clipsOf(view.dom);
    for (const clip of this.clips) {
      const box = clip.getBoundingClientRect();
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
    }
    if (bottom <= top) bottom = top + 1;
    const edges = (i: number) => ({ top: origin + at[i], bottom: origin + at[i + 1] });
    const seen = visibleRows(state.rows, edges, top, bottom);
    if (seen) {
      const margin = Math.max(MIN_MARGIN, seen.last - seen.first + 1);
      const window = nextWindow(state.window, seen.first, seen.last, state.rows, margin);
      if (window !== state.window) meta.window = window;
    }
    if (meta.window || meta.rowHeight !== undefined) setMeta(view, meta);
    else if (changed) this.markTable();
  }

  destroy(): void {
    this.cancel?.();
    views.delete(this.view.dom);
    this.view.dom.ownerDocument.removeEventListener('scroll', this.schedule, { capture: true });
    this.win?.removeEventListener('resize', this.resized);
  }
}

function setMeta(view: EditorView, meta: Meta): void {
  view.dispatch(view.state.tr.setMeta(virtualRowsKey, meta).setMeta('addToHistory', false));
}

export function virtualRowsPlugin(): Plugin<VirtualRowsState> {
  return new Plugin<VirtualRowsState>({
    key: virtualRowsKey,
    state: {
      init: (_config, state) => build(state, null),
      apply(tr: Transaction, prev, old, state) {
        const meta = tr.getMeta(virtualRowsKey) as Meta | undefined;
        if (!meta && !tr.docChanged && !tr.selectionSet) return prev;
        return build(state, prev, tr, old, meta);
      },
    },
    props: {
      decorations: (state) => virtualRowsKey.getState(state)?.decorations ?? null,
    },
    view: (view) => new Watcher(view),
  });
}

/** Moves the window of a virtual table's editor so it holds `from` to `to`. */
export function setRowWindow(view: EditorView, window: RowWindow): void {
  setMeta(view, { window });
}

/**
 * Draws row `row` of the table whose editable root is `root`, so find or a script can reach its cells, and returns
 * the row's element. Returns null when no virtual table has that root or the row is out of range. The row stays
 * drawn until the page scrolls away from it, so a caller scrolls it into view.
 */
export function revealRow(root: Element, row: number): HTMLElement | null {
  const view = views.get(root);
  const state = view ? virtualRowsKey.getState(view.state) : undefined;
  const table = view ? tableOf(view.state.doc) : null;
  if (!view || !state || !table || row < 0 || row >= table.childCount) return null;
  const window = around(state.window, row, table.childCount);
  if (window !== state.window) setMeta(view, { window });
  return view.nodeDOM(startsOf(view.state.doc)[row]) as HTMLElement | null;
}
