// Text elements (SPEC 6.6). A text block names its paragraphs, headings, list items, code blocks, math blocks, and
// thematic breaks in `data.ids`, in document order. It keeps their tags, styles, and checked to-dos beside the
// Markdown, which never carries them. A document holds them as attributes, and this module moves them between the two.
import type { Node as PMNode } from '@tiptap/pm/model';
import { ELEMENT_TYPES } from '../schema/specs';

/** The `ids`, `tags`, `styles`, and `checked` fields of a text block's `data` (SPEC 6.6). */
export interface ElementData {
  ids: string[];
  tags: Record<string, string[]>;
  styles: Record<string, string>;
  checked: string[];
}

export const MAX_TAGS_PER_ELEMENT = 1000;
export const MAX_TAG_LENGTH = 200;

export function emptyElementData(): ElementData {
  return { ids: [], tags: {}, styles: {}, checked: [] };
}

type Update = (node: PMNode, index: number) => Record<string, unknown>;

interface Walk {
  next: number;
  readonly update: Update;
}

function walk(node: PMNode, state: Walk, isItemLead: boolean): PMNode {
  const isElement = ELEMENT_TYPES.has(node.type.name) && !isItemLead;
  const attrs = isElement ? { ...node.attrs, ...state.update(node, state.next++) } : node.attrs;
  if (node.isInline) return node;
  const children: PMNode[] = [];
  node.forEach((child, _offset, i) => children.push(walk(child, state, node.type.name === 'listItem' && i === 0)));
  return node.type.create(attrs, children.length > 0 ? children : null, node.marks);
}

/**
 * The document with every element's attributes updated. The walk is in document order, so a list item comes before
 * the elements inside it. A list item's first paragraph belongs to the item and is skipped.
 */
export function updateElements(doc: PMNode, update: Update): PMNode {
  return walk(doc, { next: 0, update }, false);
}

/** The number of elements in a text block. */
export function countElements(doc: PMNode): number {
  let count = 0;
  updateElements(doc, () => {
    count++;
    return {};
  });
  return count;
}

/**
 * Gives each element the ID, tags, style, and checked state that the block's data names for it. A list with
 * fewer IDs than elements leaves the last elements without one, and extra IDs are ignored (SPEC 6.6).
 */
export function applyElementData(doc: PMNode, data: Partial<ElementData>): PMNode {
  const checked = new Set(data.checked ?? []);
  return updateElements(doc, (_node, index) => {
    const id = data.ids?.[index] ?? null;
    return {
      id,
      tags: id === null ? [] : (data.tags?.[id] ?? []),
      style: id === null ? null : (data.styles?.[id] ?? null),
      tagChecked: id !== null && checked.has(id),
    };
  });
}

function byKey<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The data fields for a document, and the document with an ID on every element. An element without an ID, or
 * with one that an earlier element has, gets a new one from `newId`. Maps come out with their keys in order.
 */
export function extractElementData(doc: PMNode, newId: () => string): { doc: PMNode; data: ElementData } {
  const data = emptyElementData();
  const seen = new Set<string>();
  const withIds = updateElements(doc, (node) => {
    const held = node.attrs.id as string | null;
    const id = held !== null && !seen.has(held) ? held : newId();
    seen.add(id);
    data.ids.push(id);
    const tags = (node.attrs.tags as readonly string[]).slice(0, MAX_TAGS_PER_ELEMENT);
    if (tags.length > 0) data.tags[id] = tags.map((tag) => tag.slice(0, MAX_TAG_LENGTH));
    if (node.attrs.style) data.styles[id] = node.attrs.style as string;
    if (node.attrs.tagChecked) data.checked.push(id);
    return { id };
  });
  data.tags = byKey(data.tags);
  data.styles = byKey(data.styles);
  data.checked.sort();
  return { doc: withIds, data };
}
