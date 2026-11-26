// @vitest-environment jsdom
// checks-disable-file brand-consistency: cell colors here are document data of the file format, not interface styling
import { EditorState } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import type { DecorationSet } from '@tiptap/pm/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newTableData, tableDataToDoc } from '../../../../editor/table/mapping';
import type { TableData } from '../../../../editor/schema/specs';
import { applyToRange, type Sheet } from '../model';
import { drawTable } from './draw';
import { measureTable } from './measure';
import { decorationsFor, sheetRenderKey, sheetRenderPlugin } from './plugin';
import type { SheetSource } from './plugin';

function fixture(rows = 2, cols = 2): { data: TableData; sheet: Sheet } {
  const data = newTableData(cols, rows, false);
  const first = data.rows[0];
  const last = data.rows[data.rows.length - 1];
  const sheet = applyToRange({}, data, [first.id, data.columns[0].id], [last.id, data.columns[0].id], {
    fill: '#1e293b',
    align: { h: 'center' },
  }).sheet;
  return { data, sheet };
}

const attrsOf = (set: DecorationSet) =>
  set.find().map((d) => (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs);

/** The table with `text` typed at the end of the first cell of row `row`. */
function typed(data: TableData, row: number, text: string): TableData {
  const col = data.columns[0].id;
  return {
    ...data,
    rows: data.rows.map((r, i) =>
      i === row ? { ...r, cells: { ...r.cells, [col]: { markdown: `${r.cells[col]?.markdown ?? ''}${text}` } } } : r,
    ),
  };
}

/** The position inside the first paragraph of the first cell of row `row`. */
function cellStart(doc: EditorState['doc'], row: number): number {
  let pos = 1;
  for (let r = 0; r < row; r += 1) pos += doc.firstChild!.child(r).nodeSize;
  return pos + 3;
}

describe('sheet render plugin', () => {
  it('decorates the table, each row, and each cell with variables and data attributes', () => {
    const { data, sheet } = fixture();
    const doc = tableDataToDoc(data);
    const set = decorationsFor(doc, drawTable({ sheet, table: data, scheme: 'light' }));
    const found = set.find();
    expect(found).toHaveLength(1 + data.rows.length + data.rows.length * data.columns.length);
    const specs = attrsOf(set);
    expect(specs.filter((a) => 'data-cell' in a)).toHaveLength(4);
    expect(specs.filter((a) => 'data-sheet' in a)).toHaveLength(1);
    const filled = specs.filter((a) => a.style?.includes('--cell-fill:#1e293b'));
    expect(filled).toHaveLength(2);
    expect(filled[0].style).toContain('--cell-h:center');
  });

  it('draws nothing for a block without a sheet source, and reuses the decorations until something changes', () => {
    const { data, sheet } = fixture();
    const doc = tableDataToDoc(data);
    let source: SheetSource | null = null;
    const plugin = sheetRenderPlugin({ source: () => source, scheme: () => 'light' });
    let state = EditorState.create({ doc, plugins: [plugin] });
    const decorations = plugin.props.decorations as (s: EditorState) => DecorationSet;
    expect(decorations.call(plugin, state)?.find() ?? []).toHaveLength(0);
    source = { sheet, table: data };
    // The source changed without a transaction: the integration asks for a fresh drawing.
    state = state.apply(state.tr.setMeta(sheetRenderKey, { refresh: true }));
    const first = decorations.call(plugin, state);
    expect(first.find().length).toBeGreaterThan(0);
    expect(decorations.call(plugin, state)).toBe(first);
    expect(state.apply(state.tr.setMeta('other', 1)).plugins.length).toBe(1);
    expect(sheetRenderKey.getState(state.apply(state.tr.setMeta('other', 1)))?.set).toBe(first);
  });
});

describe('sheet render plugin state', () => {
  it('maps the decorations through typing instead of drawing the table again', () => {
    const { data, sheet } = fixture(6, 3);
    const source: SheetSource = { sheet, table: data };
    const plugin = sheetRenderPlugin({ source: () => source, scheme: () => 'light' });
    let state = EditorState.create({ doc: tableDataToDoc(data), plugins: [plugin] });
    state = state.apply(state.tr.setMeta(sheetRenderKey, { refresh: true }));
    const before = sheetRenderKey.getState(state)!;
    expect(before.set.find()).toHaveLength(1 + 6 + 18);
    const after = state.apply(state.tr.insertText('hello', cellStart(state.doc, 3)));
    const now = sheetRenderKey.getState(after)!;
    expect(now.drawn).toBe(before.drawn);
    expect(now.set).not.toBe(before.set);
    expect(now.set.find()).toHaveLength(1 + 6 + 18);
    // Every decoration still sits on its row or cell.
    const cell = after.doc.firstChild!.child(3).child(0);
    expect(
      now.set.find(cellStart(after.doc, 3) - 2, cellStart(after.doc, 3) - 2 + cell.nodeSize).length,
    ).toBeGreaterThan(0);
  });

  it('draws again only the rows whose text changed when the source changes', () => {
    const { data, sheet } = fixture(6, 3);
    let source: SheetSource = { sheet, table: data };
    const plugin = sheetRenderPlugin({ source: () => source, scheme: () => 'light' });
    let state = EditorState.create({ doc: tableDataToDoc(data), plugins: [plugin] });
    state = state.apply(state.tr.setMeta(sheetRenderKey, { refresh: true }));
    const before = sheetRenderKey.getState(state)!;
    source = { sheet, table: typed(data, 2, 'a much longer text that spills') };
    const after = state.apply(state.tr.insertText('a', cellStart(state.doc, 2)));
    const now = sheetRenderKey.getState(after)!;
    expect([...(now.drawn?.changed ?? [])]).toEqual([2]);
    expect(now.drawn?.cells[0]).toBe(before.drawn?.cells[0]);
    expect(now.set.find()).toHaveLength(1 + 6 + 18);
    // The set is what a full build gives.
    const full = decorationsFor(after.doc, drawTable({ ...source, scheme: 'light' }));
    expect(attrsOf(now.set)).toEqual(attrsOf(full));
  });

  it('draws again when the rows change shape, and nothing while the document and source disagree', () => {
    const { data, sheet } = fixture(3, 2);
    const source: SheetSource = { sheet, table: data };
    const plugin = sheetRenderPlugin({ source: () => source, scheme: () => 'light' });
    let state = EditorState.create({ doc: tableDataToDoc(data), plugins: [plugin] });
    state = state.apply(state.tr.setMeta(sheetRenderKey, { refresh: true }));
    const bigger = tableDataToDoc(newTableData(2, 4, false));
    const replaced = state.apply(state.tr.replaceWith(0, state.doc.content.size, bigger.content));
    expect(sheetRenderKey.getState(replaced)?.set.find()).toHaveLength(0);
  });
});

describe('measured values in the decorations', () => {
  it('puts measured values into the decorations through a meta-only transaction', () => {
    const { data, sheet } = fixture(3, 2);
    const source: SheetSource = { sheet, table: data };
    const plugin = sheetRenderPlugin({ source: () => source, scheme: () => 'light' });
    let state = EditorState.create({ doc: tableDataToDoc(data), plugins: [plugin] });
    state = state.apply(state.tr.setMeta(sheetRenderKey, { refresh: true }));
    const measured = new Map([[1, new Map([[0, { '--cell-spill-r': '120px', 'data-fill-text': 'abab' }]])]]);
    const tr = state.tr.setMeta(sheetRenderKey, { measured, full: true });
    expect(tr.docChanged).toBe(false);
    const next = state.apply(tr);
    const cells = attrsOf(sheetRenderKey.getState(next)!.set).filter((a) => 'data-cell' in a);
    expect(cells.filter((a) => a.style?.includes('--cell-spill-r:120px'))).toHaveLength(1);
    expect(cells.filter((a) => a['data-fill-text'] === 'abab')).toHaveLength(1);
    // The same measurement again changes nothing.
    expect(sheetRenderKey.getState(next.apply(next.tr.setMeta(sheetRenderKey, { measured, full: true })))?.set).toBe(
      sheetRenderKey.getState(next)?.set,
    );
  });
});

describe('typing in a styled table of 4,000 cells', () => {
  // One keystroke: the transaction, the plugin's state, and the decorations ProseMirror asks for. A typing budget
  // is 16 ms at the 95th percentile. Before the fix, every keystroke drew the whole table again (about 40 ms here).
  const p95 = (times: number[]) => [...times].sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

  function run(sourceChanges: boolean): number {
    const { data, sheet } = fixture(200, 20);
    // Style every cell: the first column has a fill, and the sheet has a look and banding.
    const styled = { ...sheet, table: { look: 'light-fern', band: { rows: true } } } as Sheet;
    let source: SheetSource = { sheet: styled, table: data };
    const plugin = sheetRenderPlugin({ source: () => source, scheme: () => 'light' });
    let state = EditorState.create({ doc: tableDataToDoc(data), plugins: [plugin] });
    state = state.apply(state.tr.setMeta(sheetRenderKey, { refresh: true }));
    const decorations = plugin.props.decorations as (s: EditorState) => DecorationSet;
    expect(sheetRenderKey.getState(state)!.set.find().length).toBeGreaterThan(4000);
    const times: number[] = [];
    let table = data;
    for (let i = 0; i < 60; i += 1) {
      const row = 100 + (i % 3);
      const started = performance.now();
      if (sourceChanges) {
        table = typed(table, row, 'x');
        source = { sheet: styled, table };
      }
      state = state.apply(state.tr.insertText('x', cellStart(state.doc, row)));
      decorations.call(plugin, state);
      if (i >= 10) times.push(performance.now() - started);
    }
    return p95(times);
  }

  it('stays within 16 ms at the 95th percentile when the source is unchanged', () => {
    expect(run(false)).toBeLessThanOrEqual(16);
  });

  it('stays within 16 ms at the 95th percentile when the source changes with each keystroke', () => {
    expect(run(true)).toBeLessThanOrEqual(16);
  });
});

describe('the measuring pass in an editor', () => {
  const rect = (width: number) => ({ width, height: 20, left: 0, right: width, top: 0, bottom: 20, x: 0, y: 0 });
  let view: EditorView | null = null;
  afterEach(() => {
    view?.destroy();
    view = null;
    vi.restoreAllMocks();
  });

  function mount(): { sent: Transaction[]; root: HTMLElement } {
    const data = newTableData(3, 3, false);
    const sheet = applyToRange({}, data, [data.rows[0].id, data.columns[0].id], [data.rows[0].id, data.columns[0].id], {
      align: { wrap: 'overflow' },
    }).sheet;
    const source: SheetSource = { sheet, table: typed(data, 0, 'long text in the first cell') };
    const plugin = sheetRenderPlugin({ source: () => source, scheme: () => 'light' });
    const root = document.body.appendChild(document.createElement('div'));
    const sent: Transaction[] = [];
    view = new EditorView(root, {
      state: EditorState.create({
        doc: tableDataToDoc(typed(data, 0, 'long text in the first cell')),
        plugins: [plugin],
      }),
      dispatchTransaction(tr) {
        sent.push(tr);
        view!.updateState(view!.state.apply(tr));
      },
    });
    refresh(view);
    return { sent, root };
  }

  const refresh = (v: EditorView) => v.dispatch(v.state.tr.setMeta(sheetRenderKey, { refresh: true }));
  const frames = async (n: number) => {
    for (let i = 0; i < n; i += 1) await new Promise((r) => requestAnimationFrame(() => r(null)));
  };

  it('writes nothing to the cells itself when it only reads', () => {
    const { root } = mount();
    const table = root.querySelector('table')!;
    const seen: MutationRecord[] = [];
    const watch = new MutationObserver((records) => seen.push(...records));
    watch.observe(table, { attributes: true, subtree: true, childList: true, characterData: true });
    measureTable(table, { apply: false });
    seen.push(...watch.takeRecords());
    watch.disconnect();
    expect(seen).toHaveLength(0);
  });

  it('hands measured widths back through meta-only transactions, then goes quiet', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect(100) as DOMRect);
    const { sent, root } = mount();
    sent.length = 0;
    await frames(6);
    const measuring = sent.filter((tr) => tr.getMeta(sheetRenderKey)?.measured);
    expect(measuring.length).toBeGreaterThan(0);
    expect(sent.every((tr) => !tr.docChanged && tr.getMeta('addToHistory') === false)).toBe(true);
    // The value reaches the cell through the decoration, so ProseMirror wrote it.
    expect(root.querySelector('td[data-cell]')?.getAttribute('style')).toContain('--cell-spill-r');
    sent.length = 0;
    await frames(6);
    expect(sent).toHaveLength(0);
  });
});
