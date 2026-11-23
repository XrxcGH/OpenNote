// @vitest-environment jsdom
// Row virtualization in a real table editor (DESIGN.md section 18). jsdom has no layout, so these tests move the
// window by hand. The browser test (tests/ui/perf/sheet-tables.perf.spec.ts) scrolls for real.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initFlags } from '../../../../app/flags';
import { createBlockEditor } from '../../../../editor/extensions/kit';
import { DEFAULT_EDITING_VIEW } from '../../../../editor/host';
import type { EditorHost } from '../../../../editor/host';
import { tableSchema } from '../../../../editor/schema/schema';
import { drawnRows, virtualRowsKey } from './key';
import { revealRow, setRowWindow } from './plugin';
import './register';

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

/** A table of `count` rows of three cells, the first a header row: "Item", then "r1", "1", "2" and so on. */
function tableDoc(count: number): PMNode {
  const rows: PMNode[] = [];
  for (let r = 0; r < count; r++) {
    const texts = r === 0 ? ['Item', 'Qty', 'Cost'] : [`r${r}`, String(r), String(r * 2)];
    const type = r === 0 ? nodes.tableHeader : nodes.tableCell;
    rows.push(
      nodes.tableRow.create(
        null,
        texts.map((text) => type.create(null, nodes.paragraph.create(null, tableSchema.text(text)))),
      ),
    );
  }
  return nodes.doc.create(null, nodes.table.create(null, rows));
}

let editors: Editor[] = [];
beforeAll(() => initFlags('dev'));
afterEach(() => {
  editors.forEach((editor) => {
    editor.view.dom.remove();
    editor.destroy();
  });
  editors = [];
});

function mount(count: number): Editor {
  const root = document.body.appendChild(document.createElement('div'));
  const editor = createBlockEditor(root, tableDoc(count), { kind: 'table', block: 'b1', host });
  editors.push(editor);
  return editor;
}

/** The table body's nodes, one per row: a <tr>, or a placeholder comment. */
const rowsOf = (editor: Editor) => [...editor.view.dom.querySelector('tbody')!.childNodes] as HTMLElement[];
const isPlaceholder = (node: Node) => node.nodeType === Node.COMMENT_NODE;
const placeholders = (editor: Editor) => rowsOf(editor).filter(isPlaceholder);

describe('below the threshold', () => {
  it('draws every row of a 1,999-row table, with the DOM of a table without virtualization', () => {
    const editor = mount(1999);
    const rows = rowsOf(editor);
    expect(rows).toHaveLength(1999);
    expect(placeholders(editor)).toHaveLength(0);
    expect(rows.every((tr) => tr.querySelectorAll('td, th').length === 3)).toBe(true);
    expect(rows[1998].textContent).toBe('r199819983996');
    // No attribute of virtualization reaches an ordinary table.
    expect(editor.view.dom.querySelector('table')?.hasAttribute('aria-rowcount')).toBe(false);
    expect(editor.view.dom.querySelector('[data-vrow]')).toBeNull();
    expect(drawnRows(editor.state)).toBeNull();
  });

  it('draws every row of a 2,000-row table too', () => {
    const editor = mount(2000);
    expect(placeholders(editor)).toHaveLength(0);
  });
});

describe('above the threshold', () => {
  it('draws the first rows and leaves placeholders for the rest, with the row count for screen readers', () => {
    const editor = mount(2001);
    const rows = rowsOf(editor);
    expect(rows).toHaveLength(2001);
    const drawn = rows.filter((tr) => !isPlaceholder(tr));
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThanOrEqual(80);
    expect(rows[0].getAttribute('aria-rowindex')).toBe('1');
    expect(rows[5].getAttribute('aria-rowindex')).toBe('6');
    expect(isPlaceholder(rows[2000])).toBe(true);
    expect(rows[2000].childNodes).toHaveLength(0);
    const table = editor.view.dom.querySelector('table');
    expect(table?.getAttribute('aria-rowcount')).toBe('2001');
    // The document stays whole.
    expect(editor.state.doc.firstChild?.childCount).toBe(2001);
  });

  it('moves the drawn rows with the window, and keeps the placeholders out of layout', () => {
    const editor = mount(5000);
    setRowWindow(editor.view, { from: 3000, to: 3040 });
    const rows = rowsOf(editor);
    expect(rows[3010].querySelectorAll('td')).toHaveLength(3);
    expect(rows[3010].getAttribute('aria-rowindex')).toBe('3011');
    expect(isPlaceholder(rows[10])).toBe(true);
    // Scrolling leaves the caret's row behind; the window is one run of rows.
    expect(isPlaceholder(rows[0])).toBe(true);
    expect(drawnRows(editor.state)).toEqual(Array.from({ length: 40 }, (_, i) => 3000 + i));
    // Padding holds the place of the rows outside the window: their heights go on the element around the editor.
    const host = editor.view.dom.parentElement!;
    expect(parseFloat(host.style.getPropertyValue('--opennote-vrows-above'))).toBeGreaterThan(0);
    expect(parseFloat(host.style.getPropertyValue('--opennote-vrows-below'))).toBeGreaterThan(0);
  });

  it('draws the row a selection moves to, and types into it', () => {
    const editor = mount(3000);
    const table = editor.state.doc.firstChild!;
    let pos = 1;
    for (let r = 0; r < 2500; r++) pos += table.child(r).nodeSize;
    const caret = TextSelection.create(editor.state.doc, pos + 3);
    editor.view.dispatch(editor.state.tr.setSelection(caret));
    expect(isPlaceholder(rowsOf(editor)[2500])).toBe(false);
    editor.view.dispatch(editor.state.tr.insertText('x'));
    expect(rowsOf(editor)[2500].querySelector('td')?.textContent).toBe('xr2500');
    expect(placeholders(editor).length).toBeGreaterThan(2800);
  });

  it('reveals a row for find and returns its element', () => {
    const editor = mount(4000);
    const row = revealRow(editor.view.dom, 3900);
    expect(row?.tagName).toBe('TR');
    expect(row?.textContent).toBe('r390039007800');
    expect(revealRow(editor.view.dom, 4000)).toBeNull();
  });

  it('draws every row again when rows are deleted down to the threshold, and virtualizes when one is added', () => {
    const editor = mount(2001);
    const table = editor.state.doc.firstChild!;
    const last = table.child(2000);
    const end = 1 + table.content.size;
    editor.view.dispatch(editor.state.tr.delete(end - last.nodeSize, end));
    expect(rowsOf(editor)).toHaveLength(2000);
    expect(placeholders(editor)).toHaveLength(0);
    expect(rowsOf(editor)[1999].textContent).toBe('r199919993998');
    expect(editor.view.dom.querySelector('table')?.hasAttribute('aria-rowcount')).toBe(false);
    editor.view.dispatch(editor.state.tr.insert(end - last.nodeSize, last));
    expect(placeholders(editor).length).toBeGreaterThan(1900);
    expect(virtualRowsKey.getState(editor.state)?.virtual).toBe(true);
  });
});

describe('the last cell', () => {
  // The spreadsheet keys' Ctrl+End, with its announcement, runs in the browser test; here a cell selection lands on
  // the last cell the way that command leaves it.
  it('draws the last row of a 10,001-row table when the selection goes there, and numbers it 10,001', () => {
    const editor = mount(10_001);
    const table = editor.state.doc.firstChild!;
    const lastCell = 1 + table.content.size - 1 - table.lastChild!.lastChild!.nodeSize;
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, lastCell)));
    const rows = rowsOf(editor);
    const last = rows[10_000];
    expect(isPlaceholder(last)).toBe(false);
    expect(last.getAttribute('aria-rowindex')).toBe('10001');
    expect(last.querySelectorAll('td')[2].textContent).toBe('20000');
    expect(editor.view.dom.querySelector('table')?.getAttribute('aria-rowcount')).toBe('10001');
    expect(isPlaceholder(rows[5000])).toBe(true);
    expect(rows.filter((row) => !isPlaceholder(row)).length).toBeLessThan(200);
  });
});
