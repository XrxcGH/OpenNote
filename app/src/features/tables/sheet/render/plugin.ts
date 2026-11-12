// The ProseMirror plugin that draws `data.sheet` styles (ADR 0056). It turns `drawTable`'s result into node
// decorations on the table, its rows, and its cells, and keeps them in plugin state. A transaction that changes only
// the document maps the set; a new source draws again just the rows whose text changed. The measuring pass reads
// layout after a change and hands what it found back in a meta-only transaction (no undo step), so the decorations
// carry the measured values and ProseMirror's own DOM is never written to from outside its updates. The cell text
// stays the cell's own, so the caret, selection, and screen readers still read the words.

import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { drawTable, styleText } from './draw';
import type { Drawn, DrawInput, DrawnTable } from './draw';
import { measureTable } from './measure';
import type { CellProps, Measured } from './measure';
import type { Scheme } from './color';
import './render.css';

/** What the plugin draws from. The sheet integration supplies it from the block's data. */
export type SheetSource = Omit<DrawInput, 'scheme'>;

export interface SheetRenderOptions {
  /**
   * The table block's sheet and table, or null when the block has no styles to draw. Return the same object until
   * the data changes, and keep `shown` the same function too: a new one redraws every row.
   */
  source: () => SheetSource | null;
  scheme: () => Scheme;
}

export const sheetRenderKey = new PluginKey<SheetRenderState>('opennote.sheetRender');

/** What the plugin remembers between transactions. */
export interface SheetRenderState {
  source: SheetSource | null;
  scheme: Scheme;
  drawn: DrawnTable | null;
  set: DecorationSet;
  /** What the measuring pass found, by row and cell position. */
  measured: Measured;
  /** The table's rows and cells at the last full build, to tell a structure change from a text change. */
  shape: string;
}

interface Meta {
  /** Measured rows (all shown rows when `full`), from the measuring pass. */
  measured?: Measured;
  full?: boolean;
  /** Draw again from the current source (the integration's source changed without a transaction). */
  refresh?: true;
}

/** The color scheme the person sees. */
export function currentScheme(): Scheme {
  const set = document.documentElement.dataset.theme;
  if (set === 'dark' || set === 'light') return set;
  // A document with no media queries (a test document) is light.
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const attrsOf = (d: Drawn, extra: Record<string, string> = {}, measured?: CellProps): Record<string, string> => {
  const vars = { ...d.vars };
  const data: Record<string, string> = { ...extra, ...d.data };
  if (measured) {
    for (const [name, value] of Object.entries(measured)) {
      if (name.startsWith('--')) vars[name] = value;
      else data[name] = value;
    }
  }
  const style = styleText(vars);
  return { ...data, ...(style ? { style } : {}) };
};

/** The table's rows and cell counts, which a text change leaves alone. */
function shapeOf(table: PMNode | null | undefined): string {
  if (!table) return '';
  const counts: number[] = [];
  table.forEach((row) => counts.push(row.childCount));
  return counts.join(',');
}

/** Decorations of one row and its cells. */
function rowDecorations(
  row: PMNode,
  r: number,
  rowFrom: number,
  map: TableMap,
  drawn: DrawnTable,
  measured: Measured,
): Decoration[] {
  const found: Decoration[] = [Decoration.node(rowFrom, rowFrom + row.nodeSize, attrsOf(drawn.rows[r]))];
  const props = measured.get(r);
  row.forEach((cell, cellOffset, c) => {
    const from = rowFrom + 1 + cellOffset;
    const rect = map.findCell(from - 1);
    const d = drawn.cells[rect.top]?.[rect.left];
    if (d) found.push(Decoration.node(from, from + cell.nodeSize, attrsOf(d, { 'data-cell': '' }, props?.get(c))));
  });
  return found;
}

const tableSpec = { sheetTable: true };

/** Node decorations for the table in `doc`, from a drawn table (and the measured values, when there are any). */
export function decorationsFor(doc: PMNode, drawn: DrawnTable, measured: Measured = new Map()): DecorationSet {
  const table = doc.firstChild;
  if (!table || table.childCount !== drawn.rows.length) return DecorationSet.empty;
  const found: Decoration[] = [Decoration.node(0, table.nodeSize, attrsOf(drawn.table), tableSpec)];
  const map = TableMap.get(table);
  table.forEach((row, rowOffset, r) => found.push(...rowDecorations(row, r, 1 + rowOffset, map, drawn, measured)));
  return DecorationSet.create(doc, found);
}

/** The set with the decorations of the given rows made again and the others kept. */
function redrawRows(
  set: DecorationSet,
  doc: PMNode,
  drawn: DrawnTable,
  measured: Measured,
  rows: ReadonlySet<number>,
): DecorationSet {
  const table = doc.firstChild;
  if (!table || rows.size === 0) return set;
  const map = TableMap.get(table);
  const old: Decoration[] = [];
  const fresh: Decoration[] = [];
  table.forEach((row, rowOffset, r) => {
    if (!rows.has(r)) return;
    const from = 1 + rowOffset;
    const to = from + row.nodeSize;
    old.push(...set.find(from, to, (spec) => spec?.sheetTable !== true).filter((d) => d.from >= from && d.to <= to));
    fresh.push(...rowDecorations(row, r, from, map, drawn, measured));
  });
  return set.remove(old).add(doc, fresh);
}

const sameProps = (a: CellProps | undefined, b: CellProps | undefined): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
};

const sameRow = (a: Map<number, CellProps> | undefined, b: Map<number, CellProps> | undefined): boolean => {
  if (a === b) return true;
  const cells = (m: Map<number, CellProps> | undefined) => [...(m ?? [])].filter(([, p]) => Object.keys(p).length > 0);
  const x = cells(a);
  const y = cells(b);
  return x.length === y.length && x.every(([c, p]) => sameProps(p, b?.get(c)));
};

/** The rows where `found` differs from `current`; when `full`, the rows only `current` has count too. */
export function changedRows(current: Measured, found: Measured, full: boolean): Set<number> {
  const rows = new Set<number>();
  for (const [r, cells] of found) if (!sameRow(current.get(r), cells)) rows.add(r);
  if (full) for (const [r, cells] of current) if (!found.has(r) && !sameRow(cells, undefined)) rows.add(r);
  return rows;
}

/** Makes the sheet render plugin draw again from its source, for a source that changed without a transaction. */
export function refreshSheetRender(view: { state: { tr: Transaction }; dispatch: (tr: Transaction) => void }): void {
  view.dispatch(view.state.tr.setMeta(sheetRenderKey, { refresh: true } satisfies Meta).setMeta('addToHistory', false));
}

const EMPTY: SheetRenderState = {
  source: null,
  scheme: 'light',
  drawn: null,
  set: DecorationSet.empty,
  measured: new Map(),
  shape: '',
};

/** The table decoration survived the transaction's mapping (it did not, when the table was replaced). */
function tableKept(tr: Transaction): boolean {
  const old = tr.before.firstChild;
  if (!old) return false;
  const from = tr.mapping.mapResult(0, 1);
  const to = tr.mapping.mapResult(old.nodeSize, -1);
  return !from.deleted && !to.deleted && to.pos > from.pos;
}

/** The measured rows after a measuring transaction, and the rows whose values changed. */
function mergeMeasured(prev: SheetRenderState, meta: Meta | undefined): { measured: Measured; dirty: Set<number> } {
  if (!meta?.measured) return { measured: prev.measured, dirty: new Set() };
  const full = meta.full === true;
  const dirty = changedRows(prev.measured, meta.measured, full);
  return { measured: full ? new Map(meta.measured) : new Map([...prev.measured, ...meta.measured]), dirty };
}

/** The plugin's state after a transaction. */
function nextState(
  source: SheetSource,
  scheme: Scheme,
  tr: Transaction,
  prev: SheetRenderState,
  doc: PMNode,
): SheetRenderState {
  const meta = tr.getMeta(sheetRenderKey) as Meta | undefined;
  const table = doc.firstChild;
  const redraw = source !== prev.source || scheme !== prev.scheme || meta?.refresh === true;
  const { measured, dirty } = mergeMeasured(prev, meta);
  // A text-only change of the same structure maps the set; anything else builds it again.
  const shape = shapeOf(table);
  const sameStructure = prev.drawn !== null && prev.set !== DecorationSet.empty && shape === prev.shape;
  const kept = !tr.docChanged || (sameStructure && tableKept(tr));
  const base = tr.docChanged && kept ? prev.set.map(tr.mapping, doc) : prev.set;

  if (!redraw && prev.drawn && sameStructure && kept) {
    const set = redrawRows(base, doc, prev.drawn, measured, dirty);
    return set === prev.set && measured === prev.measured && !tr.docChanged ? prev : { ...prev, set, measured };
  }
  const drawn = !redraw && prev.drawn ? prev.drawn : drawTable({ ...source, scheme }, prev.drawn ?? undefined);
  if (!table || table.childCount !== drawn.rows.length) {
    return { source, scheme, drawn, set: DecorationSet.empty, measured, shape: '' };
  }
  if (sameStructure && kept && drawn.changed) {
    const rows = new Set([...drawn.changed, ...dirty]);
    return { source, scheme, drawn, set: redrawRows(base, doc, drawn, measured, rows), measured, shape };
  }
  return { source, scheme, drawn, set: decorationsFor(doc, drawn, measured), measured, shape };
}

/** The rows of the table whose node differs between two documents, or 'all' when the table's structure changed. */
function rowsChanged(before: PMNode, after: PMNode): Set<number> | 'all' {
  const a = before.firstChild;
  const b = after.firstChild;
  if (!a || !b || a.childCount !== b.childCount) return 'all';
  const changed = new Set<number>();
  b.forEach((row, _offset, r) => row !== a.child(r) && changed.add(r));
  return changed;
}

/** The plugin's view part: after a change it measures what changed in a frame and hands the values to the state. */
function measuringView(view: EditorView) {
  let frame = 0;
  let rows: Set<number> | 'all' = 'all';
  let chain = 0;
  const run = () => {
    frame = 0;
    const now = rows;
    rows = new Set();
    const dom = view.dom.querySelector<HTMLElement>('table[data-sheet]');
    const state = sheetRenderKey.getState(view.state);
    if (!dom || !state || view.isDestroyed) return;
    const full = now === 'all';
    const found = measureTable(dom, { rows: full ? undefined : now, apply: false });
    if (changedRows(state.measured, found, full).size === 0) return;
    const meta: Meta = { measured: found, full };
    view.dispatch(view.state.tr.setMeta(sheetRenderKey, meta).setMeta('addToHistory', false));
  };
  const schedule = (what: Set<number> | 'all') => {
    if (what === 'all' || rows === 'all') rows = 'all';
    else what.forEach((r) => (rows as Set<number>).add(r));
    if (frame === 0) frame = requestAnimationFrame(run);
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule('all')) : null;
  observer?.observe(view.dom);
  schedule('all');
  return {
    update(v: EditorView, prev: EditorState) {
      const now = sheetRenderKey.getState(v.state);
      const before = sheetRenderKey.getState(prev);
      if (!now || !before) return;
      // The values we just set can move other things (a turned cell grows its row), so look once more, a few times.
      if (now.measured !== before.measured) {
        chain += 1;
        if (chain <= 3) schedule('all');
        return;
      }
      chain = 0;
      if (now.source !== before.source || now.scheme !== before.scheme || now.shape !== before.shape) {
        return schedule('all');
      }
      if (v.state.doc === prev.doc) return;
      const changed = rowsChanged(prev.doc, v.state.doc);
      if (changed === 'all' || changed.size > 0) schedule(changed);
    },
    destroy() {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer?.disconnect();
    },
  };
}

export function sheetRenderPlugin(options: SheetRenderOptions): Plugin<SheetRenderState> {
  return new Plugin<SheetRenderState>({
    key: sheetRenderKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev, _old, state): SheetRenderState {
        const source = options.source();
        if (!source) return prev.source === null ? prev : EMPTY;
        return nextState(source, options.scheme(), tr, prev, state.doc);
      },
    },
    props: { decorations: (state) => sheetRenderKey.getState(state)?.set },
    view: measuringView,
  });
}
