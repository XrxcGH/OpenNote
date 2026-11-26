// The fill's cost on a large table (DESIGN.md section 12): one layout snapshot, not one per new cell.
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { describe, expect, it } from 'vitest';
import { tableSchema } from '../../../editor/schema/schema';
import { textsOf } from '../keys/state';
import { fillContent } from './actions';

const { nodes } = tableSchema;

function bigTable(rows: number, columns: number): PMNode {
  const made = Array.from({ length: rows }, (_, r) =>
    nodes.tableRow.create(
      null,
      Array.from({ length: columns }, (_, c) => {
        const text = r === 0 ? String(c + 1) : '';
        return nodes.tableCell.create(null, nodes.paragraph.create(null, text ? tableSchema.text(text) : null));
      }),
    ),
  );
  return nodes.doc.create(null, nodes.table.create(null, made));
}

describe('fill on a large table', () => {
  it('fills 2,000 cells of an 8,000 cell table within a time budget, with the right text', () => {
    const view = {
      state: EditorState.create({ doc: bigTable(1600, 5) }),
      dispatch(tr: never) {
        view.state = view.state.apply(tr);
      },
    };
    const start = performance.now();
    fillContent(
      view as unknown as EditorView,
      {
        source: { top: 0, left: 0, bottom: 0, right: 4 },
        box: { top: 0, left: 0, bottom: 400, right: 4 },
        direction: 'down',
      },
      'series',
    );
    const ms = performance.now() - start;
    const texts = textsOf(view.state.doc);
    // Each column is one number, which a fill copies down.
    expect(texts[400]).toEqual(['1', '2', '3', '4', '5']);
    expect(texts[401]).toEqual(['', '', '', '', '']);
    expect(ms).toBeLessThan(2000);
  });
});
