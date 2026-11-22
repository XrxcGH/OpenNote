// @vitest-environment jsdom
/* eslint-disable opennote/feature-boundaries -- The test mounts the row virtualization that the table block loads late. */
// The spreadsheet keys in a long table, where row virtualization draws only some rows (features/page/tables/virtual).
import type { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import type { Decoration, DecorationSet } from '@tiptap/pm/view';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initFlags } from '../../../app/flags';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { DEFAULT_EDITING_VIEW } from '../../../editor/host';
import type { EditorHost } from '../../../editor/host';
import { tableSchema } from '../../../editor/schema/schema';
import { drawnRows } from '../../page/tables/virtual/key';
import { setRowWindow } from '../../page/tables/virtual/plugin';
import '../../page/tables/virtual/register';
import { sheetKeysPlugin } from './plugin';
import { textsOf } from './state';

const host: EditorHost = {
  settings: () => DEFAULT_EDITING_VIEW,
  flag: () => true,
  announce: () => {},
  openMenu: () => Promise.resolve(null),
  screenReader: () => false,
  spelling: () => null,
  selectBlocks: () => {},
};

const { nodes } = tableSchema;

function tableDoc(count: number): PMNode {
  const rows: PMNode[] = [];
  for (let r = 0; r < count; r++)
    rows.push(
      // Row and column IDs, as a stored table has them, so the table needs no normalizing.
      nodes.tableRow.create(
        { rowId: `row${r}` },
        [`r${r}`, String(r), String(r * 2)].map((text, c) =>
          nodes.tableCell.create({ colId: `col${c}` }, nodes.paragraph.create(null, tableSchema.text(text))),
        ),
      ),
    );
  return nodes.doc.create(null, nodes.table.create(null, rows));
}

let editors: Editor[] = [];
beforeAll(() => initFlags('dev'));
afterEach(() => {
  editors.forEach((editor) => editor.destroy());
  editors = [];
});

/** The position of the cell at `row`, `column`. */
function cellPos(doc: PMNode, row: number, column: number): number {
  const table = doc.firstChild!;
  let pos = 1;
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize;
  pos += 1;
  for (let c = 0; c < column; c++) pos += table.child(row).child(c).nodeSize;
  return pos;
}

describe('a range selection in a 3,000-row table', () => {
  it('marks aria-selected only on the cells of the rows the table draws', () => {
    // Out of the document: jsdom has no layout, so the page's scroll watcher would move the window on its own.
    const editor = createBlockEditor(document.createElement('div'), tableDoc(3000), {
      kind: 'table',
      block: 'b1',
      host,
    });
    editors.push(editor);
    const plugin = sheetKeysPlugin({ spreadsheet: true, announce: () => {} });
    editor.registerPlugin(plugin, (added, plugins) => [added, ...plugins]);
    const { view } = editor;
    view.dom.dispatchEvent(new FocusEvent('focus'));
    // The whole table, as Ctrl+A or Ctrl+Shift+End from the first cell selects it.
    view.dispatch(
      view.state.tr.setSelection(
        CellSelection.create(view.state.doc, cellPos(view.state.doc, 0, 0), cellPos(view.state.doc, 2999, 2)),
      ),
    );
    const drawn = drawnRows(view.state)!;
    expect(drawn.length).toBeLessThan(400);
    const decorations = (plugin.props.decorations as (s: typeof view.state) => DecorationSet).call(plugin, view.state);
    const selected = decorations
      .find()
      .filter(
        (d: Decoration) => (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs['aria-selected'],
      );
    expect(selected).toHaveLength(drawn.length * 3);
  });
});

/** A 3,000-row table block's editor with the spreadsheet keys, out of the document (see above), and its plugin. */
function longTable() {
  const editor = createBlockEditor(document.createElement('div'), tableDoc(3000), { kind: 'table', block: 'b1', host });
  editors.push(editor);
  const plugin = sheetKeysPlugin({ spreadsheet: true, announce: () => {} });
  editor.registerPlugin(plugin, (added, plugins) => [added, ...plugins]);
  const { view } = editor;
  /** Each cell number as "row:column", with whether it sits on the cell it names. */
  const numbers = () =>
    (plugin.props.decorations as (s: typeof view.state) => DecorationSet)
      .call(plugin, view.state)
      .find()
      .map((d: Decoration) => ({ d, attrs: (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs }))
      .filter(({ attrs }) => attrs['aria-rowindex'])
      .map(({ d, attrs }) => {
        const [row, column] = [Number(attrs['aria-rowindex']), Number(attrs['aria-colindex'])];
        const placed = d.from === cellPos(view.state.doc, row - 1, column - 1);
        return `${row}:${column}${placed ? '' : ' misplaced'}`;
      });
  return { view, numbers };
}

/** How many child nodes `run` walks with forEach, the way a pass over every row of the table walks them. */
function walked(run: () => void): number {
  const original = Fragment.prototype.forEach;
  let visited = 0;
  Fragment.prototype.forEach = function (this: Fragment, f) {
    visited += this.childCount;
    original.call(this, f);
  };
  try {
    run();
  } finally {
    Fragment.prototype.forEach = original;
  }
  return visited;
}

describe('typing in a cell of a 3,000-row table', () => {
  it('walks the rows of the table at most three times per key, not once per plugin and pass', () => {
    const { view, numbers } = longTable();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view.state.doc, 5, 0) + 2)));
    // The first key checks the whole table once; the keys after it are what typing costs.
    view.dispatch(view.state.tr.insertText('x'));
    numbers();
    const visited = walked(() => {
      view.dispatch(view.state.tr.insertText('y'));
      numbers();
    });
    // A pass that checks the rows for merged cells, and ProseMirror's own when the outline of the active cell is
    // added to the cell numbers. Each visits 3,000 rows.
    expect(visited).toBeLessThanOrEqual(3 * 3000 + 100);
    expect(view.state.doc.firstChild!.child(5).firstChild!.textContent).toBe('xyr5');
  });

  it('keeps the texts of every row it left alone', () => {
    const { view } = longTable();
    const before = textsOf(view.state.doc);
    view.dispatch(view.state.tr.insertText('x', cellPos(view.state.doc, 5, 0) + 2));
    const after = textsOf(view.state.doc);
    expect(after[5]).toEqual(['xr5', '5', '10']);
    expect(after[4]).toBe(before[4]);
    expect(after[2999]).toBe(before[2999]);
  });

  it('numbers the cells of the drawn rows through typing and window moves', () => {
    const { view, numbers } = longTable();
    const expected = (rows: readonly number[]) => rows.flatMap((r) => [1, 2, 3].map((c) => `${r + 1}:${c}`));
    const sorted = () => [...numbers()].sort();
    expect(sorted()).toEqual(expected(drawnRows(view.state)!).sort());
    // Typing with the caret in the cell, as a person types: the window stays on the caret's row.
    const type = (row: number, column: number, text: string) => {
      const pos = cellPos(view.state.doc, row, column) + 2;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).insertText(text));
    };
    setRowWindow(view, { from: 1000, to: 1040 });
    expect(sorted()).toEqual(expected(drawnRows(view.state)!).sort());
    type(1010, 1, 'typed');
    expect(drawnRows(view.state)).toContain(1010);
    expect(sorted()).toEqual(expected(drawnRows(view.state)!).sort());
    setRowWindow(view, { from: 1020, to: 1070 });
    const rows = drawnRows(view.state)!;
    expect(rows[0]).toBe(1020);
    expect(sorted()).toEqual(expected(rows).sort());
    type(1030, 0, 'more');
    expect(drawnRows(view.state)).toEqual(rows);
    expect(sorted()).toEqual(expected(rows).sort());
  });
});
