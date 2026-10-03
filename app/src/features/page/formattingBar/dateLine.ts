// The date and time under a new page's title (ARCHITECTURE.md section 18.3; owner: WP4). A new page gets a first
// flowing text block with the date and time in small text. It is ordinary, editable text, so it appears in page.md.
import { isEnabled } from '../../../app/flags';
import { dateTimeText } from '../../../editor/commands/insertDate';
import { newId } from '../../../editor/ids';
import type { NodeId } from '../../../services/notes/types';
import { getSettings } from '../../../state/settings';
import { pagesClient } from '../runtime';
import type { PageId } from '../../../services/pages/types';

/** The Markdown of the date line for the moment `now`. */
export function dateLineMarkdown(now: Date = new Date()): string {
  return `<span data-size="small">${dateTimeText('dateTime', now)}</span>`;
}

/** Adds the date line to a page that was just created, when the setting and the flag are on. */
export async function addDateLine(pageId: NodeId, now: Date = new Date()): Promise<void> {
  if (!getSettings().editing.newPageDateTime || !isEnabled('page.typingHelpers') || !isEnabled('page.editor')) return;
  const page = await pagesClient().open(pageId as unknown as PageId, { viewport: null });
  try {
    if (page.initial.blocks.length > 0) return;
    const block = { id: newId(), type: 'text', data: { markdown: dateLineMarkdown(now) } };
    await page.send({ edits: [{ edit: 'insertBlock', block }] });
  } finally {
    await page.close();
  }
}
