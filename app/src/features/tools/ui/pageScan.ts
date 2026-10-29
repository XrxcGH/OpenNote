// Upcoming from every notebook (Productivity and study tools). The search index already knows which text blocks have an
// open checkbox or a tag, so a scan asks it for those and reads the due dates in them, the same way the open page is
// read. A page in a locked section is not in the index, so nothing from it comes here. The scan runs shortly after
// start-up, when the index reports a change, and now and then; it never reads a page that is not in the index.
import { isEnabled } from '../../../app/flags';
import type { SearchClient, TaggedBlock } from '../../../services/search/types';
import { pageItemsOf, replacePageItems } from './upcomingStores';
import type { PageEntry } from './upcomingStores';

/** The readings of every page that has due dates, from the blocks the index handed over. */
export function readingOf(
  blocks: readonly TaggedBlock[],
  context: { now: number; timeZone: string },
): Record<string, PageEntry> {
  const pages = new Map<string, { title: string; blocks: { id: string; markdown: string }[] }>();
  for (const block of blocks) {
    const page = pages.get(block.page) ?? { title: block.title, blocks: [] };
    page.blocks.push({ id: block.block, markdown: block.markdown });
    pages.set(block.page, page);
  }
  const entries: Record<string, PageEntry> = {};
  for (const [id, page] of pages) {
    const items = pageItemsOf({ id, title: page.title }, page.blocks, context);
    if (items.length > 0) entries[id] = { title: page.title, items };
  }
  return entries;
}

/**
 * Reads the due dates on all pages through the search index and gives them to Upcoming. `keep` lists pages whose
 * entries stay as they are because something fresher reads them (the open page). Resolves how many pages have due
 * dates, or null when this build of the app has no index to ask.
 */
export async function scanAllPages(
  client: SearchClient | null,
  keep: readonly string[] = [],
  now = Date.now(),
): Promise<number | null> {
  const extras = client?.extras;
  if (!extras) return null;
  const blocks = await extras.taggedBlocks({ kind: 'all' });
  const entries = readingOf(blocks, { now, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  replacePageItems(entries, keep);
  return Object.keys(entries).length;
}

const EVERY = 120_000;
const AFTER_CHANGE = 2_500;
let started = false;

/** Starts the scans for this window: soon after start-up, after the index changes, and every couple of minutes. */
export function startPageScan(
  getClient: () => SearchClient | null,
  shownId: () => string | null,
  clock: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = globalThis,
): () => void {
  if (started) return () => undefined;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let listening: (() => void) | null = null;
  let watched: SearchClient | null = null;

  const run = () => {
    if (!isEnabled('tools.dueDates')) return;
    const client = getClient();
    if (client && client !== watched) {
      listening?.();
      watched = client;
      listening = client.onUpdate(() => later(AFTER_CHANGE));
    }
    const open = shownId();
    void scanAllPages(client, open ? [open] : []).catch(() => undefined);
  };
  const later = (ms: number) => {
    clock.clearTimeout(timer);
    timer = clock.setTimeout(() => {
      run();
      later(EVERY);
    }, ms);
  };
  later(4_000);
  return () => {
    clock.clearTimeout(timer);
    listening?.();
    started = false;
  };
}
