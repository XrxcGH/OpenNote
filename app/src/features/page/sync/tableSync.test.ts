// @vitest-environment jsdom
// The table sync: typing in a cell is a patch of data.rows coalesced by cell, and a new row sends the whole data.
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { tableSchema } from '../../../editor/schema/schema';
import type { TableData } from '../../../editor/schema/specs';
import { META_COMMAND } from '../../../editor/meta';
import { createEditorHost } from '../editorHost';
import { attachTableSync } from './textSync';
import { syncPage, syncRig } from './testSync';

vi.mock('../../../ui/toast', () => ({ showToast: vi.fn() }));

const T = '01k6synctab1e0000000000001';
const AT = '2026-10-01T09:00:00.000Z';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

const cell = (text: string) => ({
  type: 'tableCell',
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});
const row = (...texts: string[]) => ({ type: 'tableRow', content: texts.map(cell) });

/** Rows and columns by position, with IDs r0, r1 and c0, c1. */
function toData(doc: PMNode): TableData {
  const table = doc.child(0);
  const rows: TableData['rows'] = [];
  table.forEach((tableRow, _offset, r) => {
    const cells: Record<string, { markdown: string }> = {};
    tableRow.forEach((tableCell, _o, c) => (cells[`c${c}`] = { markdown: tableCell.textContent }));
    rows.push({ id: `r${r}`, cells });
  });
  const columns = Array.from({ length: table.child(0).childCount }, (_, c) => ({ id: `c${c}`, width: 160 }));
  return { header: false, columns, rows };
}

describe('the table sync', () => {
  it('coalesces typing by cell and sends a new row as the whole data', async () => {
    const data = { header: false, columns: [], rows: [] };
    const rig = await syncRig(syncPage([], [{ id: T, type: 'table', order: 'a0', created: AT, modified: AT, data }]));
    const root = document.body.appendChild(document.createElement('div'));
    const doc = { type: 'doc', content: [{ type: 'table', content: [row('a', 'b'), row('c', 'd')] }] };
    const editor = createBlockEditor(root, tableSchema.nodeFromJSON(doc), {
      kind: 'table',
      block: T,
      host: createEditorHost(),
    });
    attachTableSync(editor, T, rig.queue, toData);
    editor.commands.setTextSelection(4);
    editor.view.dispatch(editor.state.tr.insertText('!'));
    await vi.advanceTimersByTimeAsync(150);
    const [typing] = rig.sent();
    expect(typing.coalesce).toEqual({ kind: 'typing', target: `${T}/r0/c0` });
    expect(typing.edits[0]).toMatchObject({
      edit: 'patchBlock',
      block: T,
      data: { rows: [{ id: 'r0' }, { id: 'r1' }] },
    });
    const end = editor.state.doc.child(0).nodeSize;
    editor.view.dispatch(
      editor.state.tr.insert(end - 1, editor.schema.nodeFromJSON(row('', ''))).setMeta(META_COMMAND, true),
    );
    await vi.advanceTimersByTimeAsync(0);
    const shape = rig.sent()[1];
    expect(shape.coalesce).toBeUndefined();
    expect(Object.keys(shape.edits[0].edit === 'patchBlock' ? (shape.edits[0].data ?? {}) : {})).toEqual([
      'header',
      'columns',
      'rows',
    ]);
  });
});
