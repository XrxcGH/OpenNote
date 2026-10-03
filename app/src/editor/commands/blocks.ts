// Block commands (owner: WP4): checking and cycling task items, and inserting a divider. Block types and lists
// go through turnInto.ts, which these build on.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { fromChange, selectedTextblocks } from './command';
import type { Command } from './command';
import { listAround, turnIntoChange } from './turnInto';

/** The task items the selection touches: the list items whose first paragraph it reaches. */
export function selectedTasks(tr: Transaction): { node: PMNode; pos: number }[] {
  const items: { node: PMNode; pos: number }[] = [];
  for (const { pos } of selectedTextblocks(tr)) {
    const $pos = tr.doc.resolve(pos);
    const item = $pos.parent;
    if (item.type.name === 'listItem' && $pos.index() === 0 && item.attrs.checked !== null) {
      items.push({ node: item, pos: $pos.before() });
    }
  }
  return items;
}

/**
 * Check or uncheck (Ctrl+Enter): flips the task item at the caret. Over several, it checks them all unless all
 * are checked, which unchecks them: "Check all" and "Uncheck all" over a selected list.
 */
export function toggleCheck(): Command {
  return fromChange((tr) => {
    const tasks = selectedTasks(tr);
    if (tasks.length === 0) return false;
    const checked = !tasks.every(({ node }) => node.attrs.checked === true);
    for (const { node, pos } of tasks) tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
    return true;
  });
}

/** Whether the selection is in a task item, for Check or uncheck's availability. */
export function inTask(tr: Transaction): boolean {
  return selectedTasks(tr).length > 0;
}

/** OneNote's To Do tag cycle: text becomes an open task, an open task is checked, and a checked one loses its box. */
export function cycleTodo(): Command {
  return fromChange((tr) => {
    const around = listAround(tr);
    if (!around) return turnIntoChange('checklist')(tr);
    const { item, itemPos } = around;
    const next = item.attrs.checked === null ? false : item.attrs.checked === false ? true : null;
    tr.setNodeMarkup(itemPos, undefined, { ...item.attrs, checked: next });
    return true;
  });
}

/** Inserts a divider after the current block, or in place of an empty paragraph, with a paragraph to type in after. */
export function insertDivider(): Command {
  return fromChange((tr) => {
    const schema = tr.doc.type.schema;
    const { $from } = tr.selection;
    if (!$from.parent.isTextblock || $from.parent.type.name === 'calloutTitle') return false;
    const depth = $from.depth;
    const container = $from.node(depth - 1);
    const index = $from.index(depth - 1);
    const rule = schema.nodes.horizontalRule.create();
    const paragraph = schema.nodes.paragraph.create();
    const empty = $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0;
    if (empty && container.canReplaceWith(index, index + 1, rule.type)) {
      const start = $from.before(depth);
      tr.replaceWith(start, $from.after(depth), Fragment.from([rule, paragraph]));
      tr.setSelection(TextSelection.create(tr.doc, start + rule.nodeSize + 1));
      return true;
    }
    const after = $from.after(depth);
    if (!container.canReplaceWith(index + 1, index + 1, rule.type)) return false;
    const needsParagraph = index + 1 >= container.childCount;
    tr.insert(after, needsParagraph ? Fragment.from([rule, paragraph]) : rule);
    const next = after + rule.nodeSize;
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(next + 1, tr.doc.content.size))));
    return true;
  });
}
