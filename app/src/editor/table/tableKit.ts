// Table editing in a table block's editor (ARCHITECTURE.md sections 13 and 22.4; owner: WP6). Tab and Shift+Tab
// move between cells, and Tab in the last cell adds a row. Enter and Shift+Enter break the line inside the cell.
// A normalizing plugin keeps the grid whole. Decorations give the table its name and the header cells their scope.
// The table nodes come from editor/schema, so this file adds behavior only.
import { Extension } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import type { Node as PMNode, NodeType } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { goToNextCell } from '@tiptap/pm/tables';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { t } from '../../strings/t';
import { cellAt, cellTextPos } from '../commands/tables';
import type { EditorHost } from '../host';
import { META_REMOTE } from '../meta';
import { headerNames, tableOf } from './mapping';

/** The table's accessible name: "Table: Stage, Where it happens", or "Table" without a header row. */
export function tableName(doc: PMNode): string {
  const names = headerNames(doc);
  return names.length > 0 ? t('tables.name', { columns: names.join(', ') }) : t('tables.nameUnnamed');
}

/** Whether the table is a grid: every row as wide as the widest, no merged cells, header cells only on top. */
function isWhole(table: PMNode): boolean {
  let width = -1;
  let whole = true;
  table.forEach((row, _offset, r) => {
    if (!whole) return;
    if (width === -1) width = row.childCount;
    if (row.childCount !== width) whole = false;
    const firstType = row.firstChild?.type.name;
    row.forEach((cell) => {
      if ((cell.attrs.colspan as number) !== 1 || (cell.attrs.rowspan as number) !== 1) whole = false;
      if (r > 0 && cell.type.name === 'tableHeader') whole = false;
      if (r === 0 && cell.type.name !== firstType) whole = false;
    });
  });
  return whole && width > 0;
}

/** The same table as a grid: merged cells split, short rows padded, header cells only in a whole first row. */
export function wholeTable(table: PMNode): PMNode {
  const { nodes } = table.type.schema;
  const grid: PMNode[][] = [];
  table.forEach((row) => {
    const cells: PMNode[] = [];
    row.forEach((cell) => {
      const span = Math.max(1, (cell.attrs.colspan as number) || 1);
      const widths = (cell.attrs.colwidth as number[] | null) ?? [];
      cells.push(cell.type.create({ colwidth: widths[0] ? [widths[0]] : null }, cell.content));
      for (let i = 1; i < span; i++) {
        cells.push(cell.type.create({ colwidth: widths[i] ? [widths[i]] : null }, nodes.paragraph.create()));
      }
    });
    grid.push(cells);
  });
  const width = Math.max(1, ...grid.map((cells) => cells.length));
  const header = grid[0]?.length > 0 && grid[0][0].type === nodes.tableHeader;
  const widths = Array.from({ length: width }, (_, c) => grid.find((cells) => cells[c])?.[c].attrs.colwidth ?? null);
  const rows = grid.map((cells, r) => {
    const type: NodeType = header && r === 0 ? nodes.tableHeader : nodes.tableCell;
    const filled = Array.from({ length: width }, (_, c) => {
      const content = cells[c]?.content.size ? cells[c].content : nodes.paragraph.create();
      return type.create({ colwidth: widths[c] }, content);
    });
    return nodes.tableRow.create(null, filled);
  });
  return table.type.create(
    table.attrs,
    rows.length > 0 ? rows : [nodes.tableRow.create(null, [nodes.tableCell.create(null, nodes.paragraph.create())])],
  );
}

const normalizeKey = new PluginKey('opennote.tableNormalize');

/** Keeps the table a grid after any change, such as a paste of cells, in the same undo step. */
function normalizePlugin(): Plugin {
  return new Plugin({
    key: normalizeKey,
    appendTransaction(transactions: readonly Transaction[], _old: EditorState, state: EditorState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const table = tableOf(state.doc);
      if (!table || isWhole(table)) return null;
      const tr = state.tr.replaceWith(0, state.doc.content.size, wholeTable(table));
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
  last.forEach((cell) =>
    cells.push(nodes.tableCell.create({ colwidth: cell.attrs.colwidth as unknown }, nodes.paragraph.create())),
  );
  const tr = state.tr.insert(1 + table.content.size, nodes.tableRow.create(null, cells));
  const pos = cellTextPos(tr.doc, { row: at.row + 1, column: 0 });
  if (pos !== null) tr.setSelection(TextSelection.create(tr.doc, pos));
  dispatch?.(tr.scrollIntoView());
  return true;
}

const TableKeys = Extension.create({
  name: 'opennoteTableKeys',
  // Ahead of the table extension's own Tab handling and of every keymap shared with text editors.
  priority: 1000,
  addKeyboardShortcuts() {
    const run = (command: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean) => () =>
      command(this.editor.state, (tr) => this.editor.view.dispatch(tr));
    return {
      Tab: run(nextCellOrRow),
      'Shift-Tab': run(goToNextCell(-1)),
      Enter: run(insertBreak),
      'Shift-Enter': run(insertBreak),
    };
  },
  addProseMirrorPlugins: () => [normalizePlugin(), a11yPlugin()],
});

export function tableKitExtensions(_host: EditorHost): Extensions {
  return [TableKeys];
}
