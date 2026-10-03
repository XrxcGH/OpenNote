// @vitest-environment jsdom
// The table block on the page (PLAN.md section 10.5). It shows a named <table> at once.
// Cell typing reaches the core as a patch of the rows, and Tab and Enter behave as in a table.
// Every table command keeps each row's cells in the first row's column order. New rows and columns get fresh IDs,
// and a moved row keeps its own.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { executeCommand } from '../../../commands/registry';
import type { TableData } from '../../../editor/schema/specs';
import { newTableData } from '../../../editor/table/mapping';
import type { BlockJson, Edit } from '../../../services/pages/types';
import type { PageCommandId } from '../keys';
import { textPageFixture } from '../test/fixtures';
import { cleanupPages, renderPage } from '../test/harness';
import type { PageHarness } from '../test/harness';
import { currentTable } from '../tables/current';
import { whenViewReady } from '../tables/lazyView';
import '../register';

afterEach(cleanupPages);

// jsdom has no layout, and ProseMirror measures a Range when it scrolls the caret into view.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const TABLE = '01k6f0000000000000000t0002';

function tableData(): TableData {
  const data = newTableData(3, 3, true);
  const words = [
    ['Stage', 'Where it happens', 'Notes'],
    ['One', 'Here', 'a'],
    ['Two', 'There', 'b'],
  ];
  data.rows.forEach((row, r) =>
    data.columns.forEach((column, c) => (row.cells[column.id] = { markdown: words[r][c] })),
  );
  return data;
}

async function tablePage(data: TableData = tableData()): Promise<{ page: PageHarness; editor: Editor }> {
  const fixture = textPageFixture('Before the table');
  const at = fixture.page.blocks[0].created;
  const block: BlockJson = {
    id: TABLE,
    type: 'table',
    order: 'a1',
    created: at,
    modified: at,
    data: data as unknown as Record<string, unknown>,
  };
  fixture.page.blocks.push(block);
  const page = await renderPage({ fixture, flags: { 'page.tables': true } });
  await whenViewReady(page.wrapper(TABLE));
  const editor = page.mounted.pool.mount(TABLE, { kind: 'start' }, 'target');
  if (!editor) throw new Error('The table has no editor.');
  editor.commands.focus('start');
  return { page, editor };
}

/** A key press through the editor's key handlers, as a real keydown reaches them. */
function press(editor: Editor, key: string, shiftKey = false): void {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event));
}

/** The table data the core holds: the fixture's, with every patch sent since applied. */
function held(page: PageHarness, initial: TableData): TableData {
  let data: TableData = structuredClone(initial);
  for (const edit of page.sent().flatMap((batch) => batch.edits) as Edit[]) {
    if (edit.edit === 'patchBlock' && edit.block === TABLE) data = { ...data, ...(edit.data as Partial<TableData>) };
  }
  return data;
}

function expectWhole(data: TableData): void {
  const ids = data.columns.map((column) => column.id);
  for (const row of data.rows) expect(Object.keys(row.cells)).toEqual(ids);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(data.rows.map((row) => row.id)).size).toBe(data.rows.length);
}

describe('the table block', () => {
  it('shows a real table named by its header cells', async () => {
    const { page } = await tablePage();
    const wrapper = page.wrapper(TABLE);
    expect(wrapper.getAttribute('aria-label')).toBe('Table: Stage, Where it happens, Notes');
    const headers = [...wrapper.querySelectorAll('th')];
    expect(headers.map((th) => th.textContent)).toEqual(['Stage', 'Where it happens', 'Notes']);
    expect(headers.every((th) => th.getAttribute('scope') === 'col')).toBe(true);
  });

  it('sends cell typing as a patch of the rows, coalesced as typing', async () => {
    const data = tableData();
    const { page } = await tablePage(data);
    await page.type(TABLE, '!');
    const last = page.sent().at(-1)!;
    expect(last.coalesce).toEqual({ kind: 'typing', target: TABLE });
    expect(last.edits[0]).toMatchObject({ edit: 'patchBlock', block: TABLE });
    const after = held(page, data);
    const lastRow = after.rows.at(-1)!;
    expect(lastRow.cells[after.columns[2].id].markdown).toBe('b!');
    expect(lastRow.id).toBe(data.rows[2].id);
  });

  it('moves between cells with Tab and adds a row from the last cell', async () => {
    const data = tableData();
    const { page, editor } = await tablePage(data);
    press(editor, 'Tab');
    expect(editor.state.selection.$head.parent.textContent).toBe('Where it happens');
    press(editor, 'Tab', true);
    expect(editor.state.selection.$head.parent.textContent).toBe('Stage');
    page.mounted.pool.mount(TABLE, { kind: 'end' }, 'target');
    press(editor, 'Tab');
    expect(editor.state.doc.firstChild!.childCount).toBe(4);
    await page.mounted.sync.flushAll('timer');
    const after = held(page, data);
    expect(after.rows).toHaveLength(4);
    expectWhole(after);
  });

  it('breaks the line inside a cell on Enter and Shift+Enter', async () => {
    const { editor } = await tablePage();
    press(editor, 'Enter');
    press(editor, 'Enter', true);
    const table = editor.state.doc.firstChild!;
    expect(table.childCount).toBe(3);
    const cell = table.firstChild!.firstChild!;
    expect(cell.childCount).toBe(1);
    const breaks = cell.firstChild!.content.content.filter((node) => node.type.name === 'hardBreak');
    expect(breaks).toHaveLength(2);
  });
});

describe('table commands', () => {
  const run = async (id: PageCommandId) => expect(await executeCommand(id), `${id} ran`).toBe(true);

  it('adds rows and columns with fresh IDs, in the first row column order', async () => {
    const data = tableData();
    const { page } = await tablePage(data);
    for (const id of ['table.rowBelow', 'table.rowAbove', 'table.columnRight', 'table.columnLeft'] as const) {
      await run(id);
    }
    const after = held(page, data);
    expect(after.rows).toHaveLength(5);
    expect(after.columns).toHaveLength(5);
    expectWhole(after);
    const old = new Set([...data.rows.map((row) => row.id), ...data.columns.map((column) => column.id)]);
    const fresh = [...after.rows.map((row) => row.id), ...after.columns.map((column) => column.id)].filter(
      (id) => !old.has(id),
    );
    expect(fresh).toHaveLength(4);
  });

  it('moves a row and keeps its ID', async () => {
    const data = tableData();
    const { page } = await tablePage(data);
    page.mounted.pool.mount(TABLE, { kind: 'end' }, 'target');
    await run('table.moveRowUp');
    const after = held(page, data);
    expect(after.rows.map((row) => row.id)).toEqual([data.rows[0].id, data.rows[2].id, data.rows[1].id]);
  });

  it('deletes a row and a column, and turns the header row off', async () => {
    const data = tableData();
    const { page } = await tablePage(data);
    page.mounted.pool.mount(TABLE, { kind: 'end' }, 'target');
    await run('table.deleteRow');
    await run('table.deleteColumn');
    await run('table.headerRow');
    const after = held(page, data);
    expect(after.rows).toHaveLength(2);
    expect(after.columns.map((column) => column.id)).toEqual([data.columns[0].id, data.columns[1].id]);
    expect(after.header).toBe(false);
    expectWhole(after);
    expect(page.wrapper(TABLE).querySelector('th')).toBeNull();
  });

  it('sets a column width through the table handle', async () => {
    const data = tableData();
    const { page } = await tablePage(data);
    expect(await currentTable.get()!.run({ op: 'columnWidth', width: 240 })).toBe(true);
    expect(held(page, data).columns[0].width).toBe(240);
  });

  it('opens the column width field and selects the table', async () => {
    const { editor } = await tablePage();
    await run('table.columnWidth');
    await vi.waitFor(() => expect(document.querySelector('input')).not.toBeNull());
    await run('table.select');
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
  });

  it('deletes the table as one block', async () => {
    const { page } = await tablePage();
    await run('table.deleteTable');
    expect(page.sent().at(-1)!.edits).toEqual([{ edit: 'deleteBlocks', blocks: [TABLE] }]);
    expect(page.mounted.layer.view(TABLE)).toBeNull();
  });

  it('inserts a 3 by 3 table with a header row after the text', async () => {
    const fixture = textPageFixture('First\n\nSecond');
    const text = fixture.page.blocks[0].id;
    const page = await renderPage({ fixture, flags: { 'page.tables': true } });
    page.mounted.pool.mount(text, { kind: 'start' }, 'target');
    await run('insert.table');
    const edits = page.sent().at(-1)!.edits;
    expect(edits.map((edit) => edit.edit)).toEqual(['setText', 'insertBlock', 'insertBlock']);
    const inserted = edits[1] as Extract<Edit, { edit: 'insertBlock' }>;
    const data = inserted.block.data as unknown as TableData;
    expect([data.columns.length, data.rows.length, data.header]).toEqual([3, 3, true]);
    expect(page.markdown(text)).toBe('First');
  });
});
