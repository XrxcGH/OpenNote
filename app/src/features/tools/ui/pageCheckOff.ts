// Checking off a to-do from Upcoming when it lives on a page: the page is opened, the line's box is changed in its text,
// and a repeating line gets its next copy. Upcoming then shows the item as done until the page is read again.
import { commandContext } from '../../../commands/registry';
import type { PageService } from '../../../services/pages/types';
import type { UpcomingItem } from '../upcoming';
import { boxAt, checkOffLine, setBoxAt } from '../upcoming/pageCheck';
import { markPageItem } from './upcomingStores';

export type CheckResult = 'done' | 'moved' | 'failed';

/** Writes the check (or the uncheck) for a page item into its page. */
export async function setPageItemDone(
  item: UpcomingItem,
  done: boolean,
  pages: Pick<PageService, 'open'> = commandContext('palette').platform.pages,
  now = Date.now(),
): Promise<CheckResult> {
  const page = item.page;
  if (!page?.task) return 'moved';
  try {
    const open = await pages.open(page.id, { viewport: null });
    try {
      const block = open.initial.blocks.find((one) => one.id === page.block);
      const markdown = typeof block?.data.markdown === 'string' ? block.data.markdown : null;
      // The line must still be a box in the state Upcoming last saw, or the page changed since and is left alone.
      if (markdown === null || boxAt(markdown, page.line) !== (item.done ? 'done' : 'open')) return 'moved';
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const next = done ? checkOffLine(markdown, page.line, now, zone) : setBoxAt(markdown, page.line, false);
      if (next === null) return 'moved';
      await open.send({ edits: [{ edit: 'setText', block: page.block, markdown: next }] });
    } finally {
      await open.close();
    }
  } catch {
    return 'failed';
  }
  markPageItem(item.id, done);
  return 'done';
}
