// Applying edits to a page in memory (owner after WP0: WP2). The checks follow Phase 3's: a splice must find its
// deleted text at its UTF-8 offset, blocks must exist, and new blocks get order keys between their neighbors.
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

function splice(markdown: string, at: number, del: string, ins: string): string {
  const bytes = encoder.encode(markdown);
  const removed = encoder.encode(del);
  const found = decoder.decode(bytes.subarray(at, at + removed.length));
  if (at > bytes.length || found !== del) {
    throw new PageServiceError('precondition', 'The text to replace is not where the edit says.');
  }
  return decoder.decode(bytes.subarray(0, at)) + ins + decoder.decode(bytes.subarray(at + removed.length));
}

function markdownOf(block: BlockJson): string {
  return typeof block.data.markdown === 'string' ? block.data.markdown : '';
}

/** Applies one edit in place. The caller applies a batch to a copy, so a failed edit changes nothing. */
export function applyEdit(page: PageJson, edit: Edit, now: string): void {
  switch (edit.edit) {
    case 'setText':
    case 'spliceText': {
      const block = blockOf(page, edit.block);
      const markdown = edit.edit === 'setText' ? edit.markdown : splice(markdownOf(block), edit.at, edit.del, edit.ins);
      block.data = { ...block.data, markdown };
      block.modified = now;
      return;
    }
    case 'insertBlock': {
      if (page.blocks.some((block) => block.id === edit.block.id)) {
        throw new PageServiceError('invalid', `The page already has a block ${edit.block.id}.`);
      }
      const order = orderFor(page, null, edit.after, edit.before);
      page.blocks.push({ ...structuredClone(edit.block), order, created: now, modified: now });
      sortBlocks(page);
      return;
    }
    case 'moveBlock': {
      const block = blockOf(page, edit.block);
      if (edit.frame === null) delete block.frame;
      else if (edit.frame) block.frame = { ...edit.frame };
      if (edit.after !== undefined || edit.before !== undefined) {
        block.order = orderFor(page, block.id, edit.after, edit.before);
        sortBlocks(page);
      }
      block.modified = now;
      return;
    }
    case 'patchBlock': {
      const block = blockOf(page, edit.block);
      if (edit.data) block.data = applyMergePatch(block.data, edit.data);
      if (edit.lock === null) delete block.lock;
      else if (edit.lock) block.lock = edit.lock;
      if (edit.fallback === null) delete block.fallback;
      else if (edit.fallback !== undefined) block.fallback = edit.fallback as BlockJson['fallback'];
      block.modified = now;
      return;
    }
    case 'deleteBlocks':
      edit.blocks.forEach((id) => blockOf(page, id));
      page.blocks = page.blocks.filter((block) => !edit.blocks.includes(block.id));
      return;
    case 'setPage':
      if (edit.title !== undefined) page.title = edit.title;
      if (edit.view) page.view = applyMergePatch(page.view, edit.view);
      return;
    case 'addAsset':
      if (!page.assets[edit.asset]) throw new PageServiceError('notFound', `The page has no asset ${edit.asset}.`);
      return;
  }
}
