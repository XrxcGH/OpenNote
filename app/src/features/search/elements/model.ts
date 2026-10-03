// Text elements as the page editor holds them (SPEC 6.6): a paragraph, heading, list item, or code block can carry an
// ID, tags, and a checked to-do. This module reads and writes those attributes on a ProseMirror document and turns a
// change into the merge patch that `patchBlock` takes. Pure functions, so they are tested without an editor.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { ELEMENT_TYPES } from '../../../editor/schema/specs';

export interface ElementRef {
  node: PMNode;
  pos: number;
  /** The place among the block's elements, which is the place in `data.ids`. */
  index: number;
}

/** The fields of a text block's `data` that line tags and links use. */
export interface LineData {
  ids: string[];
  tags: Record<string, string[]>;
  checked: string[];
}

export const emptyLineData = (): LineData => ({ ids: [], tags: {}, checked: [] });

/** The elements of a document, in document order. A list item's first child belongs to the item (SPEC 6.6). */
export function listElements(doc: PMNode): ElementRef[] {
  const found: ElementRef[] = [];
  doc.descendants((node, pos, parent, index) => {
    if (node.isInline) return false;
    if (ELEMENT_TYPES.has(node.type.name) && !(parent?.type.name === 'listItem' && index === 0)) {
      found.push({ node, pos, index: found.length });
    }
    return true;
  });
  return found;
}

/**
 * The elements a selection touches. A caret is in one element: the innermost. A range takes every element it
 * touches, but not an element that only surrounds the whole range.
 */
export function elementsBetween(doc: PMNode, from: number, to: number): ElementRef[] {
  const touched = listElements(doc).filter(
    (ref) => ref.pos < Math.max(to, from + 1) && ref.pos + ref.node.nodeSize > from,
  );
  return touched.filter((ref) => {
    const end = ref.pos + ref.node.nodeSize;
    const surrounds = from > ref.pos && to < end;
    if (!surrounds) return true;
    return !touched.some((other) => other !== ref && other.pos > ref.pos && other.pos < end);
  });
}

/** The position where the element's first line of text starts, for a badge. */
export function textStart(ref: ElementRef): number {
  if (ref.node.isTextblock) return ref.pos + 1;
  let at = ref.pos + 1;
  ref.node.descendants((node, offset) => {
    if (node.isTextblock) {
      at = ref.pos + 1 + offset + 1;
      return false;
    }
    return true;
  });
  return at;
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** The line data a block's `data` holds. Anything that isn't the right shape reads as empty. */
export function lineDataOf(data: Record<string, unknown> | undefined): LineData {
  const out = emptyLineData();
  if (!data) return out;
  out.ids = stringList(data.ids);
  out.checked = stringList(data.checked);
  const tags = data.tags;
  if (tags && typeof tags === 'object' && !Array.isArray(tags)) {
    for (const [id, list] of Object.entries(tags)) {
      const names = stringList(list);
      if (names.length > 0) out.tags[id] = names;
    }
  }
  return out;
}

/** Whether the line data says anything: IDs, tags, or checked boxes. */
export const hasLineData = (data: LineData): boolean =>
  data.ids.length > 0 || data.checked.length > 0 || Object.keys(data.tags).length > 0;

/** Gives every element an ID: one without, or one a split copied from its neighbor, gets a new one. */
export function ensureIds(tr: Transaction, newId: () => string): boolean {
  const seen = new Set<string>();
  let changed = false;
  for (const ref of listElements(tr.doc)) {
    const held = (ref.node.attrs.id as string | null) ?? null;
    if (held !== null && !seen.has(held)) {
      seen.add(held);
      continue;
    }
    const id = newId();
    seen.add(id);
    const node = tr.doc.nodeAt(ref.pos);
    if (node) tr.setNodeMarkup(ref.pos, undefined, { ...node.attrs, id });
    changed = true;
  }
  return changed;
}

/** The line data of a document whose elements all have IDs (see ensureIds). */
export function readLineData(doc: PMNode): LineData {
  const out = emptyLineData();
  for (const ref of listElements(doc)) {
    const id = (ref.node.attrs.id as string | null) ?? null;
    if (id === null) continue;
    out.ids.push(id);
    const tags = stringList(ref.node.attrs.tags);
    if (tags.length > 0) out.tags[id] = tags;
    if (ref.node.attrs.tagChecked) out.checked.push(id);
  }
  out.checked.sort();
  return out;
}

/** Sets the attributes the data names, by place in the block. Returns whether anything changed. */
export function applyLineData(tr: Transaction, data: LineData): boolean {
  const checked = new Set(data.checked);
  let changed = false;
  for (const ref of listElements(tr.doc)) {
    const id = data.ids[ref.index] ?? null;
    const tags = id === null ? [] : (data.tags[id] ?? []);
    const tagChecked = id !== null && checked.has(id);
    const old = ref.node.attrs;
    const same =
      (old.id ?? null) === id && sameList(stringList(old.tags), tags) && Boolean(old.tagChecked) === tagChecked;
    if (same) continue;
    tr.setNodeMarkup(ref.pos, undefined, { ...old, id, tags, tagChecked });
    changed = true;
  }
  return changed;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, at) => item === b[at]);
}

/** The merge patch (RFC 7396) that turns `before` into `after`, or null when they are the same. */
export function patchFor(before: LineData, after: LineData): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (!sameList(before.ids, after.ids)) patch.ids = after.ids;
  const tags: Record<string, string[] | null> = {};
  for (const id of Object.keys(before.tags)) if (!after.tags[id]) tags[id] = null;
  for (const [id, list] of Object.entries(after.tags)) if (!sameList(before.tags[id] ?? [], list)) tags[id] = list;
  if (Object.keys(tags).length > 0) patch.tags = tags;
  if (!sameList(before.checked, after.checked)) patch.checked = after.checked;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** The place of an element by its ID, or null. */
export function findById(doc: PMNode, id: string): ElementRef | null {
  return listElements(doc).find((ref) => ref.node.attrs.id === id) ?? null;
}
