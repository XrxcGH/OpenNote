import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { tableSchema } from '../schema/schema';
import { onlyInsideCells } from './cellEdits';

const { nodes } = tableSchema;

/** A two-by-two table: "a" and "b" on top, "c" and "d" below. */
function grid(): PMNode {
  const row = (texts: string[]) =>
    nodes.tableRow.create(
      null,
      texts.map((text) => nodes.tableCell.create(null, nodes.paragraph.create(null, tableSchema.text(text)))),
    );
  return nodes.doc.create(null, nodes.table.create(null, [row(['a', 'b']), row(['c', 'd'])]));
}

// Positions by hand: the table opens at 0, the first row at 1, its first cell at 2, that cell's paragraph at 3,
// and "a" at 4. Each cell is 5 long (cell, paragraph, one letter, two closings), so "b" sits at 9.
const state = () => EditorState.create({ doc: grid() });

describe('onlyInsideCells', () => {
  it('is true for typing in a cell', () => {
    expect(onlyInsideCells(state().tr.insertText('x', 5))).toBe(true);
  });

  it('is true for deleting text and for a mark inside one cell', () => {
    expect(onlyInsideCells(state().tr.delete(4, 5))).toBe(true);
    expect(onlyInsideCells(state().tr.addMark(4, 5, tableSchema.marks.bold.create()))).toBe(true);
  });

  it('is false for a change across two cells', () => {
    expect(onlyInsideCells(state().tr.delete(4, 10))).toBe(false);
  });

  it('is true for a mark over two cells: one step for the text of each cell', () => {
    expect(onlyInsideCells(state().tr.addMark(4, 10, tableSchema.marks.bold.create()))).toBe(true);
  });

  it('is false for a change to a cell itself, such as its span', () => {
    expect(onlyInsideCells(state().tr.setNodeMarkup(2, undefined, { colspan: 2 }))).toBe(false);
    expect(onlyInsideCells(state().tr.setNodeAttribute(2, 'colspan', 2))).toBe(false);
  });

  it('is false for a new row', () => {
    const row = nodes.tableRow.create(null, [
      nodes.tableCell.create(null, nodes.paragraph.create()),
      nodes.tableCell.create(null, nodes.paragraph.create()),
    ]);
    const s = state();
    expect(onlyInsideCells(s.tr.insert(s.doc.firstChild!.nodeSize - 1, row))).toBe(false);
  });
});
