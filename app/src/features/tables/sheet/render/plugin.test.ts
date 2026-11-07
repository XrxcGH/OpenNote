// @vitest-environment jsdom
// checks-disable-file brand-consistency: cell colors here are document data of the file format, not interface styling
import { EditorState } from '@tiptap/pm/state';
import type { DecorationSet } from '@tiptap/pm/view';
import { describe, expect, it } from 'vitest';
import { newTableData, tableDataToDoc } from '../../../../editor/table/mapping';
import type { TableData } from '../../../../editor/schema/specs';
import { applyToRange, type Sheet } from '../model';
import { drawTable } from './draw';
import { decorationsFor, sheetRenderPlugin } from './plugin';

function fixture(): { data: TableData; sheet: Sheet } {
  const data = newTableData(2, 2, false);
  const [r1, r2] = data.rows;
  const [c1] = data.columns;
  const sheet = applyToRange({}, data, [r1.id, c1.id], [r2.id, c1.id], {
    fill: '#1e293b',
    align: { h: 'center' },
  }).sheet;
  return { data, sheet };
}

describe('sheet render plugin', () => {
  it('decorates the table, each row, and each cell with variables and data attributes', () => {
    const { data, sheet } = fixture();
    const doc = tableDataToDoc(data);
    const set = decorationsFor(doc, drawTable({ sheet, table: data, scheme: 'light' }));
    const found = set.find();
    expect(found).toHaveLength(1 + data.rows.length + data.rows.length * data.columns.length);
    const specs = found.map((d) => (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs);
    expect(specs.filter((a) => 'data-cell' in a)).toHaveLength(4);
    expect(specs.filter((a) => 'data-sheet' in a)).toHaveLength(1);
    const filled = specs.filter((a) => a.style?.includes('--cell-fill:#1e293b'));
    expect(filled).toHaveLength(2);
    expect(filled[0].style).toContain('--cell-h:center');
  });

  it('draws nothing for a block without a sheet source, and reuses the decorations until something changes', () => {
    const { data, sheet } = fixture();
    const doc = tableDataToDoc(data);
    let source: { sheet: Sheet; table: TableData } | null = null;
    const plugin = sheetRenderPlugin({ source: () => source, scheme: () => 'light' });
    const state = EditorState.create({ doc, plugins: [plugin] });
    const decorations = plugin.props.decorations as (s: EditorState) => DecorationSet;
    expect(decorations.call(plugin, state).find()).toHaveLength(0);
    source = { sheet, table: data };
    const first = decorations.call(plugin, state);
    expect(first.find().length).toBeGreaterThan(0);
    expect(decorations.call(plugin, state)).toBe(first);
  });
});
