// Turn into (ARCHITECTURE.md section 17.2; owner: WP4): converts the current textblock, or the selected ones,
// between Text, Heading 1 to 6, the three list kinds, Quote, Callout, and Code, keeping the text. Converting to Code
// drops marks; converting out of Code keeps plain text. The block commands and the slash menu use these too.
import { Fragment } from '@tiptap/pm/model';
import type { NodeRange, NodeType, Node as PMNode } from '@tiptap/pm/model';
import { liftListItem, wrapInList } from '@tiptap/pm/schema-list';
import { TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { findWrapping, liftTarget } from '@tiptap/pm/transform';
import { ancestorDepth, fromChange, selectedTextblocks, viaCommand } from './command';
import type { Change, Command } from './command';

export type BlockKind =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'bulletList'
  | 'orderedList'
  | 'checklist'
  | 'quote'
  | 'callout'
  | 'codeBlock';

export const BLOCK_KINDS: readonly BlockKind[] = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'bulletList',
  'orderedList',
  'checklist',
  'quote',
  'callout',
  'codeBlock',
];

const LISTS = ['bulletList', 'orderedList'];

/** Lifts the selection out of every list around it, so its textblocks can change type. */
export const liftOutOfLists: Change = (tr) => {
  let lifted = false;
  for (let guard = 0; guard < 16; guard += 1) {
    if (ancestorDepth(tr.selection.$from, ['listItem']) < 0) break;
    if (!viaCommand(liftListItem(tr.doc.type.schema.nodes.listItem))(tr)) break;
    lifted = true;
  }
  return lifted;
};

/** Sets every selected textblock but callout titles to the type, keeping text (and marks where allowed). */
function setTextblocks(type: NodeType, attrs: Record<string, unknown> | null): Change {
  return (tr) => {
    let changed = false;
    for (const { node, pos } of selectedTextblocks(tr)) {
      if (node.type.name === 'calloutTitle') continue;
      if (node.type === type && (!attrs || Object.entries(attrs).every(([k, v]) => node.attrs[k] === v))) continue;
      const at = tr.mapping.map(pos);
      tr.setBlockType(at, at + 1, type, { ...keptAttrs(node, type), ...attrs });
      changed = true;
    }
    return changed;
  };
}

/** Element metadata travels with the text (SPEC 6.6). */
function keptAttrs(node: PMNode, type: NodeType): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const name of ['id', 'tags', 'style', 'tagChecked']) {
    if (name in node.attrs && type.spec.attrs && name in type.spec.attrs) kept[name] = node.attrs[name];
  }
  return kept;
}

function textblockKind(kind: BlockKind): { type: string; attrs: Record<string, unknown> | null } | null {
  if (kind === 'paragraph') return { type: 'paragraph', attrs: null };
  if (kind === 'codeBlock') return { type: 'codeBlock', attrs: null };
  const level = /^heading([1-6])$/.exec(kind)?.[1];
  return level ? { type: 'heading', attrs: { level: Number(level) } } : null;
}

/** The innermost list item holding the selection's start, with the list around it. */
export function listAround(tr: Transaction): { list: PMNode; listPos: number; item: PMNode; itemPos: number } | null {
  const $from = tr.selection.$from;
  const itemDepth = ancestorDepth($from, ['listItem']);
  if (itemDepth < 1) return null;
  return {
    list: $from.node(itemDepth - 1),
    listPos: $from.before(itemDepth - 1),
    item: $from.node(itemDepth),
    itemPos: $from.before(itemDepth),
  };
}

/** The list items the selection touches inside the innermost list around its start. */
function selectedItems(tr: Transaction): { node: PMNode; pos: number }[] {
  const around = listAround(tr);
  if (!around) return [];
  const items: { node: PMNode; pos: number }[] = [];
  const { from, to } = tr.selection;
  around.list.forEach((item, offset) => {
    const pos = around.listPos + 1 + offset;
    if (pos + item.nodeSize > from && pos < to + 1) items.push({ node: item, pos });
  });
  return items.length ? items : [{ node: around.item, pos: around.itemPos }];
}

function setChecked(tr: Transaction, items: readonly { node: PMNode; pos: number }[], checked: boolean | null) {
  for (const { node, pos } of items) {
    if (node.attrs.checked !== checked) tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
  }
}

/** Whether the selection is already in a list of this kind: the list's type, and task items for a checklist. */
export function inListKind(tr: Transaction, kind: 'bulletList' | 'orderedList' | 'checklist'): boolean {
  const around = listAround(tr);
  if (!around) return false;
  const items = selectedItems(tr);
  const tasks = items.every(({ node }) => node.attrs.checked !== null);
  if (kind === 'checklist') return tasks;
  return around.list.type.name === kind && !tasks;
}

/** Puts the selected textblocks in a list of this kind, or changes the list they are in. */
function toList(kind: 'bulletList' | 'orderedList' | 'checklist'): Change {
  return (tr) => {
    const schema = tr.doc.type.schema;
    const around = listAround(tr);
    if (around) {
      const items = selectedItems(tr);
      // A checklist is a bulleted list of tasks.
      setChecked(tr, items, kind === 'checklist' ? false : null);
      const listType = kind === 'checklist' ? 'bulletList' : kind;
      if (around.list.type.name !== listType) tr.setNodeMarkup(around.listPos, schema.nodes[listType]);
      return tr.docChanged;
    }
    setTextblocks(schema.nodes.paragraph, null)(tr);
    const listType = schema.nodes[kind === 'checklist' ? 'bulletList' : kind];
    if (!viaCommand(wrapInList(listType))(tr)) return wrapWholeList(tr, listType);
    if (kind === 'checklist') {
      const after = listAround(tr);
      if (after)
        after.list.forEach((item, offset) => setChecked(tr, [{ node: item, pos: after.listPos + 1 + offset }], false));
    }
    return true;
  };
}

/** Wraps the selection's block range, widened to whole list items when it starts inside one. */
function wrapRange(tr: Transaction, wrapper: NodeType, attrs: Record<string, unknown> | null = null): NodeRange | null {
  const { $from, $to } = tr.selection;
  let range = $from.blockRange($to);
  if (range && range.parent.type.name === 'listItem' && range.startIndex === 0) {
    const listDepth = ancestorDepth($from, LISTS);
    range = $from.blockRange($to, (node) => node === $from.node(listDepth - 1)) ?? range;
  }
  if (!range) return null;
  const wrapping = findWrapping(range, wrapper, attrs);
  if (!wrapping) return null;
  tr.wrap(range, wrapping);
  return range;
}

function wrapWholeList(tr: Transaction, listType: NodeType): boolean {
  return wrapRange(tr, listType) !== null;
}

/** Lifts the selection out of the innermost wrapper of this type. */
function liftOutOf(name: string): Change {
  return (tr) => {
    const { $from, $to } = tr.selection;
    const depth = ancestorDepth($from, [name]);
    if (depth < 0) return false;
    if (name === 'callout') return unwrapCallout(tr, $from.before(depth));
    const range = $from.blockRange($to, (node) => node.type.name === name);
    const target = range && liftTarget(range);
    if (!range || target === null || target === undefined) return false;
    tr.lift(range, target);
    return true;
  };
}

/** Replaces a callout with its title as a paragraph, then its body. */
function unwrapCallout(tr: Transaction, pos: number): boolean {
  const callout = tr.doc.nodeAt(pos);
  if (!callout) return false;
  const schema = tr.doc.type.schema;
  const title = callout.firstChild;
  const blocks: PMNode[] = [];
  if (title && title.content.size > 0) blocks.push(schema.nodes.paragraph.create(null, title.content));
  callout.forEach((child, _offset, index) => {
    if (index > 0) blocks.push(child);
  });
  if (blocks.length === 0) blocks.push(schema.nodes.paragraph.create());
  const keptTitle = Boolean(title && title.content.size > 0);
  const shift = keptTitle ? 1 : 3;
  const caret = Math.max(pos + 1, tr.selection.from - shift);
  tr.replaceWith(pos, pos + callout.nodeSize, Fragment.from(blocks));
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(caret, tr.doc.content.size))));
  return true;
}

/** Wraps the selected blocks in a callout of the type, with an empty title. */
export function wrapInCallout(type = 'note'): Change {
  return (tr) => {
    if (ancestorDepth(tr.selection.$from, ['calloutTitle']) >= 0) return false;
    const schema = tr.doc.type.schema;
    const { $from, $to } = tr.selection;
    let range = $from.blockRange($to);
    if (range && range.parent.type.name === 'listItem' && range.startIndex === 0) {
      const listDepth = ancestorDepth($from, LISTS);
      range = $from.blockRange($to, (node) => node === $from.node(listDepth - 1));
    }
    if (!range || !range.parent.canReplaceWith(range.startIndex, range.endIndex, schema.nodes.callout)) return false;
    const blocks: PMNode[] = [];
    for (let index = range.startIndex; index < range.endIndex; index += 1) blocks.push(range.parent.child(index));
    const callout = schema.nodes.callout.create({ type, fold: '' }, [schema.nodes.calloutTitle.create(), ...blocks]);
    const offset = tr.selection.from - range.start;
    tr.replaceWith(range.start, range.end, callout);
    const titleSize = 2;
    tr.setSelection(TextSelection.near(tr.doc.resolve(range.start + 1 + titleSize + offset)));
    return true;
  };
}

/** Converts the selection to the kind, keeping the text. A kind it already is changes nothing. */
export function turnIntoChange(kind: BlockKind): Change {
  return (tr) => {
    const schema = tr.doc.type.schema;
    const textblock = textblockKind(kind);
    if (textblock) {
      // Quote is a kind, so other kinds leave it; a callout is a container, so its blocks stay inside.
      const lifted = [liftOutOfLists(tr), liftOutOf('blockquote')(tr)].some(Boolean);
      const set = setTextblocks(schema.nodes[textblock.type], textblock.attrs)(tr);
      return lifted || set;
    }
    if (kind === 'bulletList' || kind === 'orderedList' || kind === 'checklist') {
      if (inListKind(tr, kind)) return false;
      liftOutOf('blockquote')(tr);
      return toList(kind)(tr);
    }
    // A quote or callout holds plain paragraphs, so the result is exactly the kind chosen.
    const wrapper = kind === 'quote' ? 'blockquote' : 'callout';
    if (ancestorDepth(tr.selection.$from, [wrapper]) >= 0) return false;
    liftOutOfLists(tr);
    setTextblocks(schema.nodes.paragraph, null)(tr);
    return kind === 'quote' ? wrapQuote(tr) : wrapInCallout()(tr);
  };
}

export function turnInto(kind: BlockKind): Command {
  return fromChange(turnIntoChange(kind));
}

function wrapQuote(tr: Transaction): boolean {
  if (ancestorDepth(tr.selection.$from, ['calloutTitle']) >= 0) return false;
  return wrapRange(tr, tr.doc.type.schema.nodes.blockquote) !== null;
}

/**
 * The shortcut form: a list, quote, or heading kind the selection already is goes back to text; anything else
 * turns into the kind.
 */
export function toggleKind(kind: BlockKind): Command {
  return fromChange((tr) => {
    if (kind === 'bulletList' || kind === 'orderedList' || kind === 'checklist') {
      if (!inListKind(tr, kind)) return toList(kind)(tr);
      return viaCommand(liftListItem(tr.doc.type.schema.nodes.listItem))(tr);
    }
    if (kind === 'quote') {
      return ancestorDepth(tr.selection.$from, ['blockquote']) >= 0 ? liftOutOf('blockquote')(tr) : wrapQuote(tr);
    }
    if (kind === 'callout') {
      return ancestorDepth(tr.selection.$from, ['callout']) >= 0 ? liftOutOf('callout')(tr) : wrapInCallout()(tr);
    }
    const textblock = textblockKind(kind);
    if (!textblock) return false;
    const blocks = selectedTextblocks(tr).filter(({ node }) => node.type.name !== 'calloutTitle');
    const already =
      blocks.length > 0 &&
      blocks.every(
        ({ node }) =>
          node.type.name === textblock.type && (!textblock.attrs || node.attrs.level === textblock.attrs.level),
      );
    if (already && kind !== 'paragraph') return setTextblocks(tr.doc.type.schema.nodes.paragraph, null)(tr);
    return turnIntoChange(kind)(tr);
  });
}
