// Checklist extras (FEATURES.md, Checklist shortcuts): Check all and Uncheck all for a list, finished items kept in
// place, moved to the bottom, or hidden, and the count of finished items. A list is checked the way the schema
// stores it: a list item whose `checked` attribute is true or false. Plain list items have none.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';

/** What happens to finished items of a checklist: stay, go to the bottom, or hide. */
export type FinishedMode = 'keep' | 'bottom' | 'hide';

/** The meta key on a transaction this module made, so it never reacts to its own change. */
export const CHECKLIST_META = 'opennote-checklist';

const isList = (node: PMNode) => node.type.name === 'bulletList' || node.type.name === 'orderedList';
const isTask = (node: PMNode) => node.type.name === 'listItem' && typeof node.attrs.checked === 'boolean';

export function finishedModeOf(data: Record<string, unknown>): FinishedMode {
  return data.finished === 'bottom' || data.finished === 'hide' ? data.finished : 'keep';
}

/** The finished and total task items in a document. */
export function countTasks(doc: PMNode): { done: number; total: number } {
  let done = 0;
  let total = 0;
  doc.descendants((node) => {
    if (!isTask(node)) return true;
    total += 1;
    if (node.attrs.checked === true) done += 1;
    return true;
  });
  return { done, total };
}

/** The items with finished ones last, in their order; null when they already are. */
export function finishedLast(items: readonly PMNode[]): PMNode[] | null {
  const open = items.filter((item) => item.attrs.checked !== true);
  const done = items.filter((item) => item.attrs.checked === true);
  const next = [...open, ...done];
  return next.every((item, index) => item === items[index]) ? null : next;
}

/**
 * Moves finished task items to the end of their list, in every list of the document. The caret stays in the item it
 * was in. Returns whether anything moved.
 */
export function moveFinishedToBottom(tr: Transaction): boolean {
  const lists: number[] = [];
  tr.doc.descendants((node, pos) => {
    if (isList(node) && node.childCount > 0) {
      let hasTask = false;
      node.forEach((child) => (hasTask ||= isTask(child)));
      if (hasTask) lists.push(pos);
    }
    return true;
  });
  let moved = false;
  // Later lists first, so earlier positions stay valid. Reordering keeps each list's size.
  for (const pos of lists.reverse()) {
    const list = tr.doc.nodeAt(pos);
    if (!list) continue;
    const items: PMNode[] = [];
    list.forEach((child) => items.push(child));
    const next = finishedLast(items);
    if (!next) continue;
    const head = tr.selection.from;
    let caret: number | null = null;
    if (head > pos && head < pos + list.nodeSize) {
      let start = pos + 1;
      for (const item of items) {
        if (head >= start && head <= start + item.nodeSize) {
          let at = pos + 1;
          for (const other of next) {
            if (other === item) break;
            at += other.nodeSize;
          }
          caret = at + (head - start);
          break;
        }
        start += item.nodeSize;
      }
    }
    tr.replaceWith(pos + 1, pos + list.nodeSize - 1, Fragment.from(next));
    if (caret !== null) tr.setSelection(TextSelection.near(tr.doc.resolve(caret)));
    moved = true;
  }
  return moved;
}

/** The outermost list around a position, with its start, or null outside lists. */
export function outerList(doc: PMNode, pos: number): { node: PMNode; pos: number } | null {
  const $pos = doc.resolve(pos);
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    const node = $pos.node(depth);
    if (isList(node)) return { node, pos: $pos.before(depth) };
  }
  return null;
}

/** Checks or unchecks every task item of the list around the caret, nested ones too. */
export function setAllChecked(tr: Transaction, checked: boolean): boolean {
  const list = outerList(tr.doc, tr.selection.from);
  if (!list) return false;
  const changes: { pos: number; node: PMNode }[] = [];
  list.node.descendants((node, offset) => {
    if (isTask(node) && node.attrs.checked !== checked) changes.push({ pos: list.pos + 1 + offset, node });
    return true;
  });
  if (changes.length === 0) return false;
  for (const { pos, node } of changes) tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
  return true;
}

/** Whether the caret is in a list that holds task items. */
export function inChecklist(doc: PMNode, pos: number): boolean {
  const list = outerList(doc, pos);
  return !!list && countTasks(list.node).total > 0;
}
