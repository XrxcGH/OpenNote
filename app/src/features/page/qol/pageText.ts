// The words of the shown page and of the selection in it, for the word count. Text comes from each box as it is
// now, so the count follows typing that the layer's copy of a block doesn't have yet.
import type { MountedPage } from '../mount';
import { liveText } from '../blocks/textBlock';
import { countsOf, plainText, tableText } from './words';
import type { Counts } from './words';

/** All the text of the page, one box after another. */
export function pageText(mounted: MountedPage): string {
  const parts: string[] = [];
  for (const block of mounted.layer.blocks()) {
    if (block.type === 'text') {
      const live = liveText(mounted.layer.view(block.id));
      parts.push(live ? plainText(live.liveMarkdown()) : plainText(String(block.data.markdown ?? '')));
    } else if (block.type === 'table') {
      parts.push(plainText(tableText(block.data)));
    }
  }
  return parts.join('\n');
}

/** The selected text in the active editor, or an empty string. */
export function selectedText(mounted: MountedPage): string {
  const editor = mounted.pool.active()?.editor;
  if (!editor || editor.state.selection.empty) return '';
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, '\n', ' ');
}

export interface PageCounts {
  page: Counts;
  /** Null when nothing is selected. */
  selection: Counts | null;
}

export function pageCounts(mounted: MountedPage): PageCounts {
  const selected = selectedText(mounted);
  return { page: countsOf(pageText(mounted)), selection: selected === '' ? null : countsOf(selected) };
}
