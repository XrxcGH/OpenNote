// Outline moves (ARCHITECTURE.md section 18.1; owner: WP4). The current item is the innermost list item holding
// the selection, or else the block. For a heading, it's the heading's section.
//
// - Move up and down swap the item with its previous or next sibling of the same kind, keeping the selection.
// - Promote and demote lift or sink a list item with its children, or shift a heading and its subheadings a
//   level. Past heading 6 or above heading 1, nothing changes.
// Each returns what happened, for the announcement.
import type { Fragment, Node as PMNode } from '@tiptap/pm/model';
import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { ancestorDepth } from './command';
import { itemDepth, sectionEnd } from './fold';

export type OutlineResult =
  | { kind: 'moved'; direction: 'up' | 'down' }
  | { kind: 'edge'; direction: 'up' | 'down' }
  | { kind: 'level'; level: number }
  | { kind: 'maxLevel' }
  | { kind: 'minLevel' }
  | { kind: 'noLevel' };

type Dispatch = ((tr: Transaction) => void) | undefined;

/** A run of sibling nodes in one parent: a list item, a top-level block, or a heading's section. */
interface Unit {
  from: number;
  to: number;
  heading: number | null;
}

/** The unit the selection is in. */
function currentUnit(state: EditorState): Unit {
  const { $from } = state.selection;
  const item = ancestorDepth($from, ['listItem']);
  if (item > 0) return { from: $from.before(item), to: $from.after(item), heading: null };
  const from = $from.depth > 0 ? $from.before(1) : $from.pos;
  const node = state.doc.nodeAt(from);
  if (node?.type.name === 'heading') {
    return { from, to: sectionEnd(state.doc, from), heading: node.attrs.level as number };
  }
  return { from, to: from + (node?.nodeSize ?? 0), heading: null };
}

/** The sibling unit before or after: an item, a block, or a section of the same heading level. */
function siblingUnit(state: EditorState, unit: Unit, direction: -1 | 1): { from: number; to: number } | null {
  const $from = state.doc.resolve(unit.from);
  const parent = $from.parent;
  const index = $from.index();
  if (unit.heading === null) {
    const isItem = state.doc.nodeAt(unit.from)?.type.name === 'listItem';
    if (direction < 0) {
      if (index === 0) return null;
      const before = parent.child(index - 1);
      if (!isItem && before.type.name === 'heading') return null;
      return { from: unit.from - before.nodeSize, to: unit.from };
    }
    const $to = state.doc.resolve(unit.to);
    const after = $to.nodeAfter;
    if (!after || (!isItem && after.type.name === 'heading')) return null;
    return { from: unit.to, to: unit.to + after.nodeSize };
  }
  if (direction > 0) {
    const next = state.doc.resolve(unit.to).nodeAfter;
    if (!next || next.type.name !== 'heading' || next.attrs.level !== unit.heading) return null;
    return { from: unit.to, to: sectionEnd(state.doc, unit.to) };
  }
  // Up: the nearest earlier heading of the same level, if no higher heading comes between.
  let offset = unit.from;
  for (let at = index - 1; at >= 0; at -= 1) {
    const child = parent.child(at);
    offset -= child.nodeSize;
    if (child.type.name !== 'heading') continue;
    const level = child.attrs.level as number;
    if (level < unit.heading) return null;
    if (level === unit.heading) return { from: offset, to: unit.from };
  }
  return null;
}

/** Swaps the current unit with its neighbor, keeping the selection where it was in the text. */
export function moveItem(direction: 'up' | 'down') {
  return (state: EditorState, dispatch?: Dispatch): OutlineResult => {
    const unit = currentUnit(state);
    const sibling = siblingUnit(state, unit, direction === 'up' ? -1 : 1);
    if (!sibling) return { kind: 'edge', direction };
    if (dispatch) {
      const own = state.doc.slice(unit.from, unit.to).content;
      const other = state.doc.slice(sibling.from, sibling.to).content;
      const [from, to] = direction === 'up' ? [sibling.from, unit.to] : [unit.from, sibling.to];
      const swapped = direction === 'up' ? own.append(other) : other.append(own);
      const tr = state.tr.replaceWith(from, to, swapped as Fragment);
      const shift = direction === 'up' ? sibling.from - unit.from : sibling.to - unit.to;
      const { anchor, head } = state.selection;
      tr.setSelection(TextSelection.create(tr.doc, anchor + shift, head + shift));
      dispatch(tr.scrollIntoView());
    }
    return { kind: 'moved', direction };
  };
}

/** The heading levels of a section: the heading and every subheading in it. */
function sectionHeadings(state: EditorState, unit: Unit): { pos: number; node: PMNode }[] {
  const found: { pos: number; node: PMNode }[] = [];
  state.doc.nodesBetween(unit.from, unit.to, (node, pos) => {
    if (node.type.name === 'heading' && pos >= unit.from) found.push({ pos, node });
    return !node.isTextblock;
  });
  return found;
}

/** Demote (1) or promote (-1): a list item sinks or lifts, a heading's section shifts a level. */
export function changeLevel(direction: 1 | -1) {
  return (state: EditorState, dispatch?: Dispatch): OutlineResult => {
    const { $from } = state.selection;
    const listItem = state.schema.nodes.listItem;
    if (ancestorDepth($from, ['listItem']) > 0) {
      const command = direction > 0 ? sinkListItem(listItem) : liftListItem(listItem);
      let after = state;
      if (!command(state, (tr) => (after = state.apply(tr)) && dispatch?.(tr))) {
        return direction > 0 ? { kind: 'maxLevel' } : { kind: 'minLevel' };
      }
      const item = ancestorDepth(after.selection.$from, ['listItem']);
      return item > 0
        ? { kind: 'level', level: itemDepth(after, after.selection.$from.before(item)) }
        : { kind: 'level', level: 0 };
    }
    const unit = currentUnit(state);
    if (unit.heading === null) return { kind: 'noLevel' };
    const headings = sectionHeadings(state, unit);
    const levels = headings.map(({ node }) => (node.attrs.level as number) + direction);
    if (levels.some((level) => level > 6)) return { kind: 'maxLevel' };
    if (levels[0] < 1) return { kind: 'minLevel' };
    if (dispatch) {
      const tr = state.tr;
      headings.forEach(({ pos, node }, index) =>
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: Math.max(1, levels[index]) }),
      );
      dispatch(tr);
    }
    return { kind: 'level', level: levels[0] };
  };
}
