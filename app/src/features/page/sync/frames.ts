// Applying undo, redo, and other windows' frames to the page (ARCHITECTURE.md section 10.5; owner after WP0: WP2).
// WP0 replaces each changed text block with a full parse; WP2 re-parses only the changed range.
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseTextBlock } from '../../../editor/markdown';
import type { MarkdownCache, Reparse } from '../../../editor/markdown';
import type { AppliedFrame, BlockId, BlockJson, UiSelection } from '../../../services/pages/types';

export interface FrameContext {
  textState(block: BlockId): { doc: PMNode; markdown: string } | null;
  /** To the block's editor, or its static DOM when it has none. */
  replaceText(block: BlockId, change: Reparse | { full: PMNode }, markdown: string): void;
  /** In the block layer. */
  upsertBlock(block: BlockJson): void;
  removeBlock(block: BlockId): void;
  setPageFields(fields: NonNullable<AppliedFrame['page']>): void;
  restoreSelection(selection: UiSelection): void;
  focusedBlock(): BlockId | null;
}

const markdownOf = (block: BlockJson) => (typeof block.data.markdown === 'string' ? block.data.markdown : '');

export async function applyFrame(
  frame: AppliedFrame,
  ctx: FrameContext,
  _cache: MarkdownCache,
  origin: 'undo' | 'redo' | 'remote',
): Promise<{ outsideFocus: boolean; changed: BlockId[] }> {
  const focused = ctx.focusedBlock();
  const changed: BlockId[] = [];
  for (const block of frame.blocks) {
    changed.push(block.id);
    const markdown = markdownOf(block);
    const text = block.type === 'text' ? ctx.textState(block.id) : null;
    if (text && text.markdown !== markdown) ctx.replaceText(block.id, { full: parseTextBlock(markdown) }, markdown);
    ctx.upsertBlock(block);
  }
  frame.removed.forEach((id) => ctx.removeBlock(id));
  if (frame.page) ctx.setPageFields(frame.page);
  const selection = origin === 'remote' ? null : origin === 'undo' ? frame.ui?.before : frame.ui?.after;
  if (selection) ctx.restoreSelection(selection);
  const touched = [...changed, ...frame.removed];
  return { outsideFocus: touched.some((id) => id !== focused), changed: touched };
}
