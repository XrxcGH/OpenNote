// Applying undo, redo, and other windows' frames to the page (ARCHITECTURE.md section 10.5; owner after WP0: WP2).
// A changed text block gets only its changed range replaced. That's WP1's range re-parse when it finds one. If not,
// it's a full parse (in the worker above 64 KB), trimmed to the top-level nodes that differ. So unchanged paragraphs
// keep their identity, their DOM, and their cache entries. Other blocks update from their JSON, removed blocks
// unmount, and the page fields update. Undo and redo restore the selection the step recorded.
import type { Fragment, Node as PMNode } from '@tiptap/pm/model';
import { parseInWorker, parseTextBlock, reparseRange } from '../../../editor/markdown';
import type { MarkdownCache, Reparse } from '../../../editor/markdown';
import type { AppliedFrame, BlockId, BlockJson, UiSelection } from '../../../services/pages/types';

export interface FrameContext {
  textState(block: BlockId): { doc: PMNode; markdown: string } | null;
  /** To the block's editor, or its static DOM when it has none. */
  replaceText(block: BlockId, change: Reparse | { full: PMNode }, markdown: string): void;
  /** In the block layer. */
  upsertBlock(block: BlockJson): void;
  /** The order key the core chose for a block this view inserted or moved, so the layer sorts it as the core does. */
  reorder(block: BlockId, order: string): void;
  removeBlock(block: BlockId): void;
  setPageFields(fields: NonNullable<AppliedFrame['page']>): void;
  restoreSelection(selection: UiSelection): void;
  focusedBlock(): BlockId | null;
}

/** Text above this size parses in the worker, so a frame never blocks a frame of the screen for long. */
export const WORKER_PARSE_BYTES = 64 * 1024;

const markdownOf = (block: BlockJson) => (typeof block.data.markdown === 'string' ? block.data.markdown : '');

const sameValue = (a: unknown, b: unknown) =>
  a === b || (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

function sameAttrs(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => sameValue(a[key], b[key]));
}

/**
 * Two nodes from any schema instance are the same when their types, attributes, marks, and text are. It walks
 * both trees once, so an undo in a long note compares its paragraphs without serializing them.
 */
function sameNode(a: PMNode, b: PMNode): boolean {
  if (a.type.name !== b.type.name || a.nodeSize !== b.nodeSize || a.childCount !== b.childCount) return false;
  if (a.text !== b.text || !sameAttrs(a.attrs, b.attrs) || a.marks.length !== b.marks.length) return false;
  for (let i = 0; i < a.marks.length; i++) {
    const [x, y] = [a.marks[i], b.marks[i]];
    if (x.type.name !== y.type.name || !sameAttrs(x.attrs, y.attrs)) return false;
  }
  for (let i = 0; i < a.childCount; i++) if (!sameNode(a.child(i), b.child(i))) return false;
  return true;
}

/**
 * The smallest replacement of top-level nodes that turns `doc` into `next`: the nodes both share at the start and
 * the end stay. Null when the documents are the same.
 */
export function minimalReplacement(doc: PMNode, next: PMNode): { from: number; to: number; content: Fragment } | null {
  const before = doc.content;
  const after = next.content;
  let start = 0;
  while (start < before.childCount && start < after.childCount && sameNode(before.child(start), after.child(start))) {
    start++;
  }
  if (start === before.childCount && start === after.childCount) return null;
  let end = 0;
  while (
    end < before.childCount - start &&
    end < after.childCount - start &&
    sameNode(before.child(before.childCount - 1 - end), after.child(after.childCount - 1 - end))
  ) {
    end++;
  }
  let from = 0;
  for (let i = 0; i < start; i++) from += before.child(i).nodeSize;
  let to = before.size;
  for (let i = 0; i < end; i++) to -= before.child(before.childCount - 1 - i).nodeSize;
  let cutFrom = 0;
  for (let i = 0; i < start; i++) cutFrom += after.child(i).nodeSize;
  let cutTo = after.size;
  for (let i = 0; i < end; i++) cutTo -= after.child(after.childCount - 1 - i).nodeSize;
  return { from, to, content: after.cut(cutFrom, cutTo) };
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

type TextState = { doc: PMNode; markdown: string };

/** The change from the text shown to `markdown`, worked out at once, without the worker. */
function changeNow(state: TextState, markdown: string, cache: MarkdownCache): Exclude<Reparse, 'full'> | null {
  const ranged = reparseRange(state.doc, state.markdown, markdown, cache);
  return ranged !== 'full' ? ranged : minimalReplacement(state.doc, parseTextBlock(markdown));
}

async function textChange(
  state: TextState,
  markdown: string,
  cache: MarkdownCache,
): Promise<Exclude<Reparse, 'full'> | null> {
  if (bytes(markdown) <= WORKER_PARSE_BYTES) return changeNow(state, markdown, cache);
  const ranged = reparseRange(state.doc, state.markdown, markdown, cache);
  if (ranged !== 'full') return ranged;
  return minimalReplacement(state.doc, await parseInWorker(markdown));
}

/** How many times a big text parses in the worker before the frame parses it at once. */
const WORKER_TRIES = 2;

/**
 * Replaces a text block's text with the frame's. Typing while a big text parses in the worker changes the text the
 * editor shows, and a change worked out before the wait would land at old positions. So the change is worked out
 * again against the text shown after the wait, and the last try parses at once, with nothing to wait for.
 */
async function replaceShownText(ctx: FrameContext, block: BlockId, markdown: string, cache: MarkdownCache) {
  for (let tries = 0; ; tries++) {
    const text = ctx.textState(block);
    if (!text || text.markdown === markdown) return;
    const waits = tries < WORKER_TRIES;
    const change = waits ? await textChange(text, markdown, cache) : changeNow(text, markdown, cache);
    if (waits && ctx.textState(block)?.doc !== text.doc) continue;
    // A text the editor already shows needs only the sync told; replaceText does that too.
    ctx.replaceText(block, change ?? { from: 0, to: 0, content: text.doc.content.cut(0, 0) }, markdown);
    return;
  }
}

export async function applyFrame(
  frame: AppliedFrame,
  ctx: FrameContext,
  cache: MarkdownCache,
  origin: 'undo' | 'redo' | 'remote',
): Promise<{ outsideFocus: boolean; changed: BlockId[] }> {
  const focused = ctx.focusedBlock();
  const changed: BlockId[] = [];
  for (const block of frame.blocks) {
    changed.push(block.id);
    if (block.type === 'text') await replaceShownText(ctx, block.id, markdownOf(block), cache);
    ctx.upsertBlock(block);
  }
  frame.removed.forEach((id) => ctx.removeBlock(id));
  if (frame.page) ctx.setPageFields(frame.page);
  const selection = origin === 'remote' ? null : origin === 'undo' ? frame.ui?.before : frame.ui?.after;
  if (selection) ctx.restoreSelection(selection);
  const touched = [...changed, ...frame.removed];
  const outsideFocus = touched.some((id) => id !== focused) || (frame.page !== null && touched.length === 0);
  return { outsideFocus, changed: touched };
}
