// @vitest-environment jsdom
/* eslint-disable opennote/feature-boundaries -- The test mounts the row virtualization that the table block loads late. */
// The spreadsheet keys in a long table, where row virtualization draws only some rows (features/page/tables/virtual).
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { CellSelection } from '@tiptap/pm/tables';
import type { Decoration, DecorationSet } from '@tiptap/pm/view';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initFlags } from '../../../app/flags';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { DEFAULT_EDITING_VIEW } from '../../../editor/host';
import type { EditorHost } from '../../../editor/host';
import { tableSchema } from '../../../editor/schema/schema';
import { drawnRows } from '../../page/tables/virtual/key';
import '../../page/tables/virtual/register';
import { sheetKeysPlugin } from './plugin';

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
      nodes.tableRow.create(
        null,
        [`r${r}`, String(r), String(r * 2)].map((text) =>
          nodes.tableCell.create(null, nodes.paragraph.create(null, tableSchema.text(text))),
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
