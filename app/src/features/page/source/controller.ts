// Opening and closing the Markdown source view. Opening sends what is typed so far, builds the source from the
// blocks as they are now, and puts the caret at the place that matches the one in the text. Closing reads the source
// back as the smallest changes to the page (planSource), sends them as one step, and puts the caret back in the text.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { BlockJson, Edit } from '../../../services/pages/types';
import { liveText } from '../blocks/textBlock';
import { assetTable } from '../images/assets';
import { showInserted } from '../images/insert';
import type { MountedPage } from '../mount';
import { shownMounted } from '../pagesApi';
import { readingLock, sourceState } from '../qol/stores';
import { pageSelection, selectOnPage } from '../seams/selectionStore';
import { buildSource, caretTarget, planSource, sourceCaret } from './model';
import type { SourceBlock, SourceEdit } from './model';

function labelOf(mounted: MountedPage, block: BlockJson): string {
  const data = block.data;
  if (block.type === 'image') return typeof data.alt === 'string' ? data.alt : '';
  if (block.type === 'file') {
    const asset = typeof data.asset === 'string' ? assetTable(mounted.page).get(data.asset) : null;
    return asset?.name ?? '';
  }
  return '';
}

/** The page's blocks as the source sees them: a text box's Markdown is its live text. */
export function sourceBlocks(mounted: MountedPage): SourceBlock[] {
  return mounted.layer.blocks().map((block) => ({
    id: block.id,
    type: block.type,
    markdown:
      block.type === 'text'
        ? (liveText(mounted.layer.view(block.id))?.liveMarkdown() ?? String(block.data.markdown ?? ''))
        : '',
    label: labelOf(mounted, block),
  }));
}

/** The offset in the text where line `line` starts. */
function lineStart(text: string, line: number): number {
  let at = 0;
  for (let index = 0; index < line; index += 1) {
    const next = text.indexOf('\n', at);
    if (next === -1) return text.length;
    at = next + 1;
  }
  return at;
}

/** The line and column of an offset in the text. */
export function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length - 1;
  return { line, column: offset - (before.lastIndexOf('\n') + 1) };
}

export async function openSource(mounted: MountedPage): Promise<void> {
  if (sourceState.get()) return;
  await mounted.sync.flushAll('command');
  const built = buildSource(sourceBlocks(mounted));
  let caret = 0;
  const active = mounted.pool.active();
  const markerLine = active ? built.lines.get(active.block) : undefined;
  if (active && markerLine !== undefined) {
    const { $from } = active.editor.state.selection;
    const at = sourceCaret(built.source, markerLine, $from.parent.textContent, $from.parentOffset);
    caret = lineStart(built.source, at.line) + at.column;
  }
  sourceState.set({ text: built.source, caret });
}

function toEdits(edits: readonly SourceEdit[]): Edit[] {
  return edits.map((edit): Edit => {
    if (edit.kind === 'setText') return { edit: 'setText', block: edit.block, markdown: edit.markdown };
    const block = { id: edit.id, type: 'text', data: { markdown: edit.markdown } };
    if (edit.after) return { edit: 'insertBlock', block, after: edit.after };
    return edit.before ? { edit: 'insertBlock', block, before: edit.before } : { edit: 'insertBlock', block };
  });
}

/** Sends the changes as one step and brings the text boxes up to date. */
async function apply(mounted: MountedPage, edits: readonly SourceEdit[]): Promise<void> {
  const sent = toEdits(edits);
  const ack = await mounted.sync.send({ edits: sent });
  showInserted(mounted, sent, ack.orderKeys);
  for (const edit of edits) {
    if (edit.kind !== 'setText') continue;
    // The text box may be the one the caret was in: its editor goes, so the new text shows and later typing
    // goes on from it.
    mounted.pool.reload(edit.block);
    const current = mounted.layer.block(edit.block);
    if (current) mounted.layer.upsert({ ...current, data: { ...current.data, markdown: edit.markdown } });
  }
}

/** The position in a text box of the paragraph that holds `words`, plus `offset`, or null. */
function positionIn(doc: PMNode, words: string, offset: number): number | null {
  let found: number | null = null;
  const wanted = words.slice(0, 30);
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.isTextblock) {
      if (wanted !== '' && node.textContent.includes(wanted)) found = pos + 1 + Math.min(offset, node.content.size);
      return false;
    }
    return true;
  });
  return found;
}

export async function closeSource(mounted: MountedPage): Promise<void> {
  const state = sourceState.get();
  if (!state) return;
  sourceState.set(null);
  if (!mounted.page.readOnly && !readingLock.get()) {
    const edits = planSource(state.text, sourceBlocks(mounted));
    if (edits.length > 0) await apply(mounted, edits).catch(() => undefined);
  }
  const at = lineAndColumn(state.text, state.caret);
  const target = caretTarget(state.text, at.line, at.column);
  if (!target) return;
  const block = mounted.layer.block(target.block);
  if (!block) return;
  if (block.type !== 'text') return selectOnPage({ blocks: [block.id], strokes: [] });
  const live = liveText(mounted.layer.view(block.id));
  const pos = live ? positionIn(live.liveDoc(), target.paragraph, target.offset) : null;
  if (pageSelection.get().blocks.length > 0) selectOnPage({ blocks: [], strokes: [] });
  if (pos === null) mounted.pool.mount(block.id, { kind: 'start' }, 'target');
  else mounted.pool.mount(block.id, { kind: 'selection', anchor: pos, head: pos }, 'target');
}

export async function toggleSource(): Promise<void> {
  const mounted = shownMounted.get();
  if (!mounted) return;
  if (sourceState.get()) await closeSource(mounted);
  else await openSource(mounted);
}
