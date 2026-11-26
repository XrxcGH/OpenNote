// Which changes stay inside cells (DESIGN.md section 18). Typing in a cell changes only that cell's text. The
// table's grid, its row and column IDs, and every other cell stay as they were. Code that keeps the whole table
// right, such as the normalizer and the cell numbers, can then skip a walk over every row on each key.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { AddMarkStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform';

/** A cell's content sits at depth 3 of a table block's document: the document, the table, the row, then the cell. */
const CELL_DEPTH = 3;

/** Whether `from` and `to` are both inside the content of one and the same cell. */
function inOneCell(doc: PMNode, from: number, to: number): boolean {
  if (from < 0 || to > doc.content.size) return false;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  return $from.depth >= CELL_DEPTH && $to.depth >= CELL_DEPTH && $from.start(CELL_DEPTH) === $to.start(CELL_DEPTH);
}

/**
 * Whether every step of `tr` changed only the inside of a cell: text or marks replaced within one cell's content.
 * A step of any other kind, such as one that sets a cell's attributes, counts as a change to the grid.
 */
export function onlyInsideCells(tr: Transaction): boolean {
  return tr.steps.every((step, i) => {
    const doc = tr.docs[i];
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return inOneCell(doc, step.from, step.to);
    if (!(step instanceof ReplaceStep) && !(step instanceof ReplaceAroundStep)) return false;
    let inside = true;
    step.getMap().forEach((from, to) => {
      inside &&= inOneCell(doc, from, to);
    });
    return inside;
  });
}
