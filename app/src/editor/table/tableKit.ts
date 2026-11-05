// Table editing in a table block's editor (ARCHITECTURE.md sections 13 and 22.4; owner: WP6). Tab and Shift+Tab
// move between cells, and Tab in the last cell adds a row. Enter and Shift+Enter break the line inside the cell.
// A normalizing plugin keeps the grid whole and gives rows and cells their IDs.
//
// spans.ts says which merged cells may stay, and keySeam.ts adds key bindings. Decorations give the table its name
// and the header cells their scope. The table nodes come from editor/schema, so this file adds behavior only.
import { Extension } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import type { Node as PMNode, NodeType } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { goToNextCell } from '@tiptap/pm/tables';
import { Mapping } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { t } from '../../strings/t';
import { cellAt, cellTextPos } from '../commands/tables';
import type { EditorHost } from '../host';
import { newId } from '../ids';
import { META_REMOTE } from '../meta';
import { extraTableKeys } from './keySeam';
import type { TableKeyCommand } from './keySeam';
import { headerNames, tableOf } from './mapping';
import { allowedSpans } from './spans';
import type { CellSpan } from './spans';

/** The table's accessible name: "Table: Stage, Where it happens", or "Table" without a header row. */
export function tableName(doc: PMNode): string {
  const names = headerNames(doc);
  return names.length > 0 ? t('tables.name', { columns: names.join(', ') }) : t('tables.nameUnnamed');
}

/** A cell placed in the grid: the column it starts in, and whether it keeps its span. */
interface Placed {
  cell: PMNode;
  column: number;
  keep: boolean;
}

/**
 * A slot of the grid. It holds the cell that starts there, or a slot a kept span covers. A slot a split span
 * covered becomes an empty cell, and a gap is undefined.
 */
type Slot = Placed | 'covered' | 'split' | undefined;

const spanOf = (cell: PMNode, name: 'colspan' | 'rowspan') => Math.max(1, (cell.attrs[name] as number) || 1);

/**
 * The widest a span may reach. Pasted HTML can ask for 1000 columns per cell, so a span that ends past this column
 * lays out as one column. Cells are never dropped, so a table with more plain cells than this stays whole.
 */
export const SPAN_COLUMN_LIMIT = 256;

/**
 * The table laid out as a grid. Each cell takes the first free slot of its row, left to right, and a span takes
 * the slots it covers, as ProseMirror's table map places them. A span that spans.ts allows keeps its slots; any
 * other span is split, and the slots it covered become empty cells. A span past SPAN_COLUMN_LIMIT takes one slot.
 */
function layout(table: PMNode, allowed: readonly CellSpan[]): Slot[][] {
  const height = table.childCount;
  const slots: Slot[][] = Array.from({ length: height }, () => []);
  const free = (r: number, c: number, rows: number, columns: number) => {
    for (let y = r; y < r + rows; y++) for (let x = c; x < c + columns; x++) if (slots[y][x]) return false;
    return true;
  };
  table.forEach((row, _offset, r) => {
    let column = 0;
    row.forEach((cell) => {
      while (slots[r][column]) column++;
      const wanted = spanOf(cell, 'colspan');
      const columns = column + wanted > SPAN_COLUMN_LIMIT ? 1 : wanted;
      const rows = Math.min(spanOf(cell, 'rowspan'), height - r);
      const fits = free(r, column, rows, columns);
      const keep =
        fits &&
        (columns > 1 || rows > 1) &&
        columns === wanted &&
        rows === spanOf(cell, 'rowspan') &&
        allowed.some((s) => s.row === r && s.column === column && s.rows === rows && s.columns === columns);
      if (fits) {
        for (let y = r; y < r + rows; y++)
          for (let x = column; x < column + columns; x++) slots[y][x] = keep ? 'covered' : 'split';
      }
      slots[r][column] = { cell, column, keep };
      column += fits ? columns : 1;
    });
  });
  return slots;
}

/** Whether the table is a grid: every row as wide as the widest, only allowed spans, header cells only on top. */
function isWhole(table: PMNode, allowed: readonly CellSpan[]): boolean {
  const slots = layout(table, allowed);
  const width = Math.max(0, ...slots.map((row) => row.length));
  let whole = width > 0;
  table.forEach((row, _offset, r) => {
    const firstType = row.firstChild?.type.name;
    row.forEach((cell) => {
      if (r > 0 && cell.type.name === 'tableHeader') whole = false;
      if (r === 0 && cell.type.name !== firstType) whole = false;
    });
    for (let c = 0; c < width; c++) {
      const slot = slots[r][c];
      if (!slot || slot === 'split') whole = false;
      else if (
        slot !== 'covered' &&
        !slot.keep &&
        (spanOf(slot.cell, 'colspan') > 1 || spanOf(slot.cell, 'rowspan') > 1)
      )
        whole = false;
    }
  });
  return whole;
}

/**
 * The same table as a grid: merged cells that spans.ts doesn't allow split, short rows padded, header cells only
 * in a whole first row. Rows and cells keep their other attributes, their IDs among them.
 */
export function wholeTable(table: PMNode, allowed: readonly CellSpan[] = []): PMNode {
  const { nodes } = table.type.schema;
  const slots = layout(table, allowed);
  const width = Math.max(1, ...slots.map((row) => row.length));
  const widths: (number | null)[] = Array.from({ length: width }, () => null);
  for (const row of slots) {
    for (const slot of row) {
      if (!slot || typeof slot === 'string') continue;
      const own = (slot.cell.attrs.colwidth as number[] | null) ?? [];
      const span = Math.min(spanOf(slot.cell, 'colspan'), width - slot.column);
      for (let i = 0; i < span; i++) widths[slot.column + i] ??= own[i] || null;
    }
  }
  const first = slots[0]?.[0];
  const header = typeof first === 'object' && first.cell.type === nodes.tableHeader;
  const rows: PMNode[] = [];
  table.forEach((row, _offset, r) => {
    const type: NodeType = header && r === 0 ? nodes.tableHeader : nodes.tableCell;
    const cells: PMNode[] = [];
    for (let c = 0; c < width; c++) {
      const slot = slots[r][c];
      if (slot === 'covered') continue;
      const placed = typeof slot === 'object' ? slot : null;
      if (placed?.keep) {
        const own = widths.slice(c, c + spanOf(placed.cell, 'colspan'));
        const colwidth = own.every((w) => w !== null) ? own : null;
        cells.push(type.create({ ...placed.cell.attrs, colwidth }, placed.cell.content));
        continue;
      }
      const content = placed?.cell.content.size ? placed.cell.content : nodes.paragraph.create();
      const colwidth = widths[c] ? [widths[c]] : null;
      cells.push(type.create({ ...placed?.cell.attrs, colspan: 1, rowspan: 1, colwidth }, content));
    }
    rows.push(nodes.tableRow.create(row.attrs, cells));
  });
  return table.type.create(
    table.attrs,
    rows.length > 0 ? rows : [nodes.tableRow.create(null, [nodes.tableCell.create(null, nodes.paragraph.create())])],
  );
}

/**
 * Gives every row a unique `rowId` and every cell its column's `colId` (editor/schema/schema.ts). A column takes
 * the first ID its cells carry, top to bottom, that no other column took. A row or column without one, such as a
 * pasted one, gets a fresh ID. When two rows carry one ID, the row `sources` names keeps it, else the first. Only
 * attributes change, so positions stay. Says whether it changed anything.
 */
function stampIds(tr: Transaction, allowed: readonly CellSpan[], sources: ReadonlyMap<string, number>): boolean {
  const table = tableOf(tr.doc);
  if (!table) return false;
  const slots = layout(table, allowed);
  const owners = new Map<unknown, number>();
  table.forEach((row, _offset, r) => {
    if (!owners.has(row.attrs.rowId)) owners.set(row.attrs.rowId, r);
  });
  for (const [id, r] of sources) if (r < table.childCount && table.child(r).attrs.rowId === id) owners.set(id, r);
  const width = Math.max(0, ...slots.map((row) => row.length));
  const seen = new Set<string>();
  const taken = (id: unknown): id is string => typeof id === 'string' && id !== '' && !seen.has(id);
  const claim = (id: unknown): string => {
    const next = taken(id) ? id : newId();
    seen.add(next);
    return next;
  };
  const columnIds = Array.from({ length: width }, (_, c) => {
    for (const row of slots) {
      const slot = row[c];
      const id = typeof slot === 'object' ? (slot.cell.attrs.colId as unknown) : null;
      if (taken(id)) return claim(id);
    }
    return claim(null);
  });
  let changed = false;
  let rowPos = 1;
  table.forEach((row, _offset, r) => {
    const rowId = claim(owners.get(row.attrs.rowId) === r ? row.attrs.rowId : null);
    if (row.attrs.rowId !== rowId) {
      tr.setNodeMarkup(rowPos, undefined, { ...row.attrs, rowId });
      changed = true;
    }
    const byCell = new Map<PMNode, Placed>();
    for (const slot of slots[r]) if (typeof slot === 'object' && !byCell.has(slot.cell)) byCell.set(slot.cell, slot);
    let cellPos = rowPos + 1;
    row.forEach((cell, _at, index) => {
      const placed = byCell.get(cell);
      const colId = columnIds[placed?.column ?? index];
      if (colId !== undefined && cell.attrs.colId !== colId) {
        tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, colId });
        changed = true;
      }
      cellPos += cell.nodeSize;
    });
    rowPos += row.nodeSize;
  });
  return changed;
}

/**
 * Where each row of the old table went: its ID and its row index in the new one. A row's start maps through the
 * changes, and a row inserted right before it, such as a copy dropped above it, maps to the side before it. So the
 * row that held an ID keeps it, and a copy that carries the same ID gets a fresh one. wholeTable keeps the rows in
 * order, so the index also holds after the normalizer rebuilds the table.
 */
function sourceRows(transactions: readonly Transaction[], old: PMNode, doc: PMNode): Map<string, number> {
  const sources = new Map<string, number>();
  const before = tableOf(old);
  const after = tableOf(doc);
  if (!before || !after) return sources;
  const starts = new Map<number, number>();
  let pos = 1;
  after.forEach((row, _offset, r) => {
    starts.set(pos, r);
    pos += row.nodeSize;
  });
  const mapping = new Mapping();
  for (const tr of transactions) mapping.appendMapping(tr.mapping);
  pos = 1;
  before.forEach((row) => {
    const id = row.attrs.rowId as unknown;
    const moved = mapping.mapResult(pos, 1);
    const r = moved.deleted ? undefined : starts.get(moved.pos);
    if (typeof id === 'string' && r !== undefined) sources.set(id, r);
    pos += row.nodeSize;
  });
  return sources;
}

const normalizeKey = new PluginKey('opennote.tableNormalize');

/** Keeps the table a grid with IDs after any change, such as a paste of cells, in the same undo step. */
function normalizePlugin(): Plugin {
  return new Plugin({
    key: normalizeKey,
    appendTransaction(transactions: readonly Transaction[], old: EditorState, state: EditorState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const table = tableOf(state.doc);
      if (!table) return null;
      const allowed = allowedSpans(table);
      const tr = state.tr;
      const whole = isWhole(table, allowed);
      if (!whole) tr.replaceWith(0, state.doc.content.size, wholeTable(table, allowed));
      const sources = sourceRows(transactions, old.doc, state.doc);
      const stamped = stampIds(tr, whole ? allowed : allowedSpans(tableOf(tr.doc) ?? table), sources);
      if (whole && !stamped) return null;
      if (transactions.some((one) => one.getMeta(META_REMOTE))) tr.setMeta(META_REMOTE, true);
      return tr;
    },
  });
}

/** The table's name on the table, and scope="col" on header cells, as attributes the static view also gets. */
function decorationsFor(doc: PMNode): DecorationSet {
  const table = tableOf(doc);
  if (!table) return DecorationSet.empty;
  const decorations = [Decoration.node(0, table.nodeSize, { 'aria-label': tableName(doc) })];
  const first = table.firstChild;
  if (first?.firstChild?.type.name === 'tableHeader') {
    let pos = 2;
    first.forEach((cell) => {
      decorations.push(Decoration.node(pos, pos + cell.nodeSize, { scope: 'col' }));
      pos += cell.nodeSize;
    });
  }
  return DecorationSet.create(doc, decorations);
}

const a11yKey = new PluginKey<DecorationSet>('opennote.tableA11y');

function a11yPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: a11yKey,
    state: {
      init: (_config, state) => decorationsFor(state.doc),
      // The header row is a few cells, so a change re-reads it; selection moves keep the set.
      apply: (tr, set, _old, state) => (tr.docChanged ? decorationsFor(state.doc) : set),
    },
    props: { decorations: (state) => a11yKey.getState(state) },
  });
}

function insertBreak(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const hardBreak = state.schema.nodes.hardBreak;
  if (!hardBreak || !cellAt(state)) return false;
  dispatch?.(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
  return true;
}

/** Tab in the last cell adds a row below and moves into its first cell. */
function nextCellOrRow(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  if (goToNextCell(1)(state, dispatch)) return true;
  const at = cellAt(state);
  const table = tableOf(state.doc);
  if (!at || !table || at.row !== table.childCount - 1) return false;
  const last = table.child(table.childCount - 1);
  const { nodes } = state.schema;
  const cells: PMNode[] = [];
  last.forEach((cell) => {
    const attrs = { colwidth: cell.attrs.colwidth as unknown, colId: cell.attrs.colId as unknown };
    cells.push(nodes.tableCell.create(attrs, nodes.paragraph.create()));
  });
  // The new row has no ID yet: the normalizer gives it a fresh one in the same step.
  const tr = state.tr.insert(1 + table.content.size, nodes.tableRow.create(null, cells));
  const pos = cellTextPos(tr.doc, { row: at.row + 1, column: 0 });
  if (pos !== null) tr.setSelection(TextSelection.create(tr.doc, pos));
  dispatch?.(tr.scrollIntoView());
  return true;
}

/** TableKeys' own bindings. */
const OWN_KEYS: Readonly<Record<string, TableKeyCommand>> = {
  Tab: nextCellOrRow,
  'Shift-Tab': goToNextCell(-1),
  Enter: insertBreak,
  'Shift-Enter': insertBreak,
};

/** The table keys: keySeam.ts's binding for a key first, then the table's own. */
function tableKeys(host: EditorHost): Extension {
  const extra = extraTableKeys(host);
  return Extension.create({
    name: 'opennoteTableKeys',
    // Ahead of the table extension's own Tab handling and of every keymap shared with text editors.
    priority: 1000,
    addKeyboardShortcuts() {
      const names = [...new Set([...Object.keys(extra), ...Object.keys(OWN_KEYS)])];
      const run = (name: string) => () => {
        const { view } = this.editor;
        const dispatch = (tr: Transaction) => view.dispatch(tr);
        if (extra[name]?.(view.state, dispatch, view)) return true;
        return OWN_KEYS[name]?.(view.state, dispatch, view) ?? false;
      };
      return Object.fromEntries(names.map((name) => [name, run(name)]));
    },
    addProseMirrorPlugins: () => [normalizePlugin(), a11yPlugin()],
  });
}

export function tableKitExtensions(host: EditorHost): Extensions {
  return [tableKeys(host)];
}
