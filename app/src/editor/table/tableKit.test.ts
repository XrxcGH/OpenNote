// @vitest-environment jsdom
// The table kit's normalizer. Merged cells split unless spans.ts allows them. Rows and cells keep their IDs, and
// pasted rows get fresh ones. The seams spans.ts and keySeam.ts start empty.
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
import { createBlockEditor } from '../extensions/kit';
import { DEFAULT_EDITING_VIEW } from '../host';
import type { EditorHost } from '../host';
import { createMarkdownCache } from '../markdown';
import { tableSchema } from '../schema/schema';
import { extraTableKeys } from './keySeam';
import { docToTableData, newTableData, tableDataToDoc, tableOf } from './mapping';
import { allowedSpans } from './spans';
import { wholeTable } from './tableKit';

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
const cell = (text: string, attrs: Record<string, unknown> = {}) =>
  nodes.tableCell.create(attrs, nodes.paragraph.create(null, text ? tableSchema.text(text) : null));
const row = (cells: PMNode[], attrs: Record<string, unknown> | null = null) => nodes.tableRow.create(attrs, cells);
const table = (rows: PMNode[]) => nodes.table.create(null, rows);
const texts = (node: PMNode) => {
  const out: string[][] = [];
  node.forEach((r) => {
    const line: string[] = [];
    r.forEach((c) => line.push(c.textContent));
    out.push(line);
  });
  return out;
};

let roots: HTMLElement[] = [];
afterEach(() => {
  roots.forEach((root) => root.remove());
  roots = [];
});

describe('the table normalizer', () => {
  it('splits a merged cell, keeping its text and the IDs of its row and column', () => {
    const merged = table([
      row([cell('a', { colspan: 2, colId: 'c1' })], { rowId: 'r1' }),
      row([cell('b', { colId: 'c1' }), cell('c', { colId: 'c2' })], { rowId: 'r2' }),
    ]);
    const whole = wholeTable(merged);
    expect(texts(whole)).toEqual([
      ['a', ''],
      ['b', 'c'],
    ]);
    expect(whole.child(0).attrs.rowId).toBe('r1');
    expect(whole.child(0).child(0).attrs).toMatchObject({ colId: 'c1', colspan: 1, rowspan: 1 });
  });

  it('puts the cells beside a split row span where the table showed them', () => {
    const merged = table([row([cell('a', { rowspan: 2 }), cell('b')]), row([cell('c')])]);
    expect(texts(wholeTable(merged))).toEqual([
      ['a', 'b'],
      ['', 'c'],
    ]);
  });

  it('keeps a span spans.ts allows', () => {
    const merged = table([row([cell('a', { colspan: 2 })]), row([cell('b'), cell('c')])]);
    const whole = wholeTable(merged, [{ row: 0, column: 0, rows: 1, columns: 2 }]);
    expect(whole.child(0).childCount).toBe(1);
    expect(whole.child(0).child(0).attrs.colspan).toBe(2);
  });

  it('gives a pasted row a fresh ID and its cells their columns’ IDs, in the same step', () => {
    const data = newTableData(2, 2, false);
    const root = document.body.appendChild(document.createElement('div'));
    roots.push(root);
    const editor = createBlockEditor(root, tableDataToDoc(data), { kind: 'table', block: 'b1', host });
    // A paste brings rows of the editor's own schema, without IDs: they are never in HTML.
    const pastedRow = editor.schema.nodeFromJSON(row([cell('p'), cell('q')]).toJSON());
    editor.view.dispatch(editor.state.tr.insert(1, pastedRow));
    const pasted = tableOf(editor.state.doc)!.child(0);
    expect(typeof pasted.attrs.rowId).toBe('string');
    expect(data.rows.map((one) => one.id)).not.toContain(pasted.attrs.rowId);
    const columns: unknown[] = [];
    pasted.forEach((one) => columns.push(one.attrs.colId));
    expect(columns).toEqual(data.columns.map((column) => column.id));
    const next = docToTableData(editor.state.doc, data, createMarkdownCache());
    expect(next.rows.slice(1).map((one) => one.id)).toEqual(data.rows.map((one) => one.id));
    expect(next.rows[0].id).toBe(pasted.attrs.rowId);
    editor.destroy();
  });

  it('lets the source row keep its ID when a copy that carries it is dropped above it', () => {
    const data = newTableData(2, 2, false);
    const root = document.body.appendChild(document.createElement('div'));
    roots.push(root);
    const editor = createBlockEditor(root, tableDataToDoc(data), { kind: 'table', block: 'b1', host });
    // A drag within one editor keeps the row's attributes in the slice, so the copy carries the source's ID.
    const source = tableOf(editor.state.doc)!.child(1);
    editor.view.dispatch(editor.state.tr.insert(1, source));
    const rows = tableOf(editor.state.doc)!;
    expect(rows.child(2).attrs.rowId).toBe(data.rows[1].id);
    expect(rows.child(1).attrs.rowId).toBe(data.rows[0].id);
    expect(typeof rows.child(0).attrs.rowId).toBe('string');
    expect(data.rows.map((one) => one.id)).not.toContain(rows.child(0).attrs.rowId);
    editor.destroy();
  });

  it('lays a pasted span past the column limit out as one column', () => {
    const wide = table([row(Array.from({ length: 10 }, () => cell('x', { colspan: 1000 })))]);
    const whole = wholeTable(wide);
    expect(whole.child(0).childCount).toBe(10);
    whole.child(0).forEach((one) => expect(one.attrs.colspan).toBe(1));
  });
});

describe('the table seams', () => {
  it('start empty: no spans are allowed and no keys are added', () => {
    expect(allowedSpans(tableOf(tableDataToDoc(newTableData(2, 2, false)))!)).toEqual([]);
    expect(extraTableKeys(host)).toEqual({});
  });
});
