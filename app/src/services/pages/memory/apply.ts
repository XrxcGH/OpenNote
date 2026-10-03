// Applying edits to a page in memory (owner: WP2). The checks follow Phase 3's (crates/core/src/ops/resolve): a
// splice must find its deleted text at its UTF-8 offset, blocks must exist, locked blocks refuse what their lock
// forbids, and new blocks get order keys between their neighbors.
import { applyMergePatch } from '../../../platform/mergePatch';
import { PageServiceError } from '../types';
import type { BlockId, BlockJson, Edit, PageJson } from '../types';

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** A key that sorts after `a` and before `b`, where null is the start or the end. */
export function keyBetween(a: string | null, b: string | null): string {
  let high = b;
  let out = '';
  for (let i = 0; ; i++) {
    const low = a !== null && i < a.length ? DIGITS.indexOf(a[i]) : 0;
    const top = high !== null && i < high.length ? DIGITS.indexOf(high[i]) : DIGITS.length;
    if (top - low > 1) return out + DIGITS[Math.floor((low + top) / 2)];
    out += DIGITS[low];
    if (top - low === 1) high = null;
  }
}

export function sortBlocks(page: PageJson): void {
  page.blocks.sort((x, y) => (x.order < y.order ? -1 : x.order > y.order ? 1 : 0));
}

function blockOf(page: PageJson, id: BlockId): BlockJson {
  const block = page.blocks.find((candidate) => candidate.id === id);
  if (!block) throw new PageServiceError('notFound', `The page has no block ${id}.`);
  return block;
}

/** The block, copied into `page.blocks` first, so the page this one was copied from keeps its own. */
function ownBlock(page: PageJson, id: BlockId): BlockJson {
  const index = page.blocks.findIndex((candidate) => candidate.id === id);
  if (index < 0) throw new PageServiceError('notFound', `The page has no block ${id}.`);
  const block = structuredClone(page.blocks[index]);
  page.blocks[index] = block;
  return block;
}

/**
 * A copy of `page` that edits may change: its own block list and fields, sharing each block until an edit
 * copies it. Pages are never changed in place, so undo steps can share their blocks.
 */
export function editableCopy(page: PageJson): PageJson {
  return { ...page, blocks: [...page.blocks], assets: { ...page.assets } };
}

/** Text and data edits need a block that isn't locked with `all`. */
function editable(block: BlockJson): void {
  if (block.lock === 'all') throw new PageServiceError('locked', `Block ${block.id} is locked.`);
}

/** Moves need a block with no lock at all. */
function movable(block: BlockJson): void {
  if (block.lock) throw new PageServiceError('locked', `Block ${block.id} is locked in place.`);
}

/** The order key for a block placed after `after` or before `before`, or at the end. */
function orderFor(page: PageJson, moving: BlockId | null, after?: BlockId, before?: BlockId): string {
  const others = page.blocks.filter((block) => block.id !== moving);
  let index = others.length;
  if (after !== undefined) index = others.findIndex((block) => block.id === after) + 1;
  else if (before !== undefined) index = others.findIndex((block) => block.id === before);
  if (index < 0 || (after !== undefined && index === 0)) {
    throw new PageServiceError('notFound', 'The block to place next to is gone.');
  }
  return keyBetween(others[index - 1]?.order ?? null, others[index]?.order ?? null);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One splice of a block's Markdown, with `at` in UTF-8 bytes, as the core records it. */
export interface ByteSplice {
  at: number;
  del: string;
  ins: string;
}

/** The splice that turns `before` into `after`, as the core makes one from `setText`. Null when they're equal. */
export function textSplice(before: string, after: string): ByteSplice | null {
  if (before === after) return null;
  const a = [...before];
  const b = [...after];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return {
    at: encoder.encode(a.slice(0, start).join('')).length,
    del: a.slice(start, a.length - end).join(''),
    ins: b.slice(start, b.length - end).join(''),
  };
}

function splice(markdown: string, at: number, del: string, ins: string): string {
  const bytes = encoder.encode(markdown);
  const removed = encoder.encode(del);
  const found = decoder.decode(bytes.subarray(at, at + removed.length));
  const boundary = at === bytes.length || (at < bytes.length && (bytes[at] & 0xc0) !== 0x80);
  if (at > bytes.length || !boundary || found !== del) {
    throw new PageServiceError('precondition', 'The text to replace is not where the edit says.');
  }
  return decoder.decode(bytes.subarray(0, at)) + ins + decoder.decode(bytes.subarray(at + removed.length));
}

export function markdownOf(block: BlockJson | undefined): string {
  return typeof block?.data.markdown === 'string' ? block.data.markdown : '';
}

/** A frame with no values is no frame, as in the core. */
const isEmptyFrame = (frame: object) => Object.values(frame).every((value) => value === undefined);

/**
 * Applies one edit to a page from editableCopy and returns the text splice it made, if any. The caller applies a
 * batch to a copy, so a failed edit changes nothing.
 */
export function applyEdit(page: PageJson, edit: Edit, now: string): ByteSplice | null {
  switch (edit.edit) {
    case 'setText':
    case 'spliceText': {
      editable(blockOf(page, edit.block));
      const before = markdownOf(blockOf(page, edit.block));
      const markdown = edit.edit === 'setText' ? edit.markdown : splice(before, edit.at, edit.del, edit.ins);
      const made =
        edit.edit === 'setText' ? textSplice(before, markdown) : { at: edit.at, del: edit.del, ins: edit.ins };
      if (!made || markdown === before) return null;
      const block = ownBlock(page, edit.block);
      block.data = { ...block.data, markdown };
      block.modified = now;
      return made;
    }
    case 'insertBlock': {
      if (page.blocks.some((block) => block.id === edit.block.id)) {
        throw new PageServiceError('invalid', `The page already has a block ${edit.block.id}.`);
      }
      const order = orderFor(page, null, edit.after, edit.before);
      const { frame, ...rest } = structuredClone(edit.block);
      const block: BlockJson = { ...rest, order, created: now, modified: now };
      if (frame && !isEmptyFrame(frame)) block.frame = frame;
      page.blocks.push(block);
      sortBlocks(page);
      return null;
    }
    case 'moveBlock': {
      movable(blockOf(page, edit.block));
      const block = ownBlock(page, edit.block);
      if (edit.frame === null || (edit.frame && isEmptyFrame(edit.frame))) delete block.frame;
      else if (edit.frame) block.frame = { ...edit.frame };
      if (edit.after !== undefined || edit.before !== undefined) {
        block.order = orderFor(page, block.id, edit.after, edit.before);
        sortBlocks(page);
      }
      block.modified = now;
      return null;
    }
    case 'patchBlock': {
      if (edit.data || edit.fallback !== undefined) editable(blockOf(page, edit.block));
      const block = ownBlock(page, edit.block);
      if (edit.data) block.data = applyMergePatch(block.data, edit.data);
      if (edit.lock === null) delete block.lock;
      else if (edit.lock) block.lock = edit.lock;
      if (edit.fallback === null) delete block.fallback;
      else if (edit.fallback !== undefined) block.fallback = edit.fallback as BlockJson['fallback'];
      block.modified = now;
      return null;
    }
    case 'deleteBlocks': {
      edit.blocks.forEach((id) => editable(blockOf(page, id)));
      page.blocks = page.blocks.filter((block) => !edit.blocks.includes(block.id));
      const order = page.view.readingOrder;
      if (order) page.view = { ...page.view, readingOrder: order.filter((id) => !edit.blocks.includes(id)) };
      return null;
    }
    case 'setPage':
      if (edit.title !== undefined) page.title = edit.title;
      if (edit.view) page.view = applyMergePatch(page.view, edit.view);
      return null;
    case 'addAsset':
      if (!page.assets[edit.asset]) throw new PageServiceError('notFound', `The page has no asset ${edit.asset}.`);
      return null;
  }
}
