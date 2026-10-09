// Text read from media joins the search index (Phase 8 and 12). While a page is shown, its pictures are read for text
// in the background, one at a time, once each, and the words are handed to the index. The words stay on this device,
// outside the page, and a page in a locked section keeps none. Nothing runs unless the person turned on reading text
// in images, and nothing asks them anything.
//
// Handwriting and transcripts arrive through indexMediaText, which the pen layer and the recording tools call when
// they have recognized something; the index treats all three alike.
import { isEnabled } from '../../../app/flags';
import { loadApi } from '../../intel';
import { shownMounted } from '../../page';
import type { MountedPage } from '../../page';
import type { MediaKind } from '../../../services/search/types';
import { maybeSearchClient } from '../client';

/** Recorded for a picture with no words in it, so it is not read again at every visit. */
const NO_WORDS = String.fromCharCode(0x200b);
const START_DELAY_MS = 2500;

export interface MediaText {
  page: string;
  block: string;
  kind: MediaKind;
  text: string;
}

/** Hands recognized text to the index. Returns whether the index changed. Empty text forgets the block's words. */
export async function indexMediaText(entry: MediaText): Promise<boolean> {
  const extras = maybeSearchClient()?.extras;
  if (!extras || !isEnabled('search.indexMedia')) return false;
  try {
    return await extras.setMediaText(entry.page, entry.block, entry.kind, entry.text);
  } catch {
    return false;
  }
}

const scanned = new Set<string>();
/** Failed reads per picture: the page is looked at again every few seconds, so a picture that fails is given up on. */
const failures = new Map<string, number>();
const MAX_FAILURES = 3;

async function imageBlob(mounted: MountedPage, asset: string): Promise<Blob | null> {
  try {
    const response = await fetch(mounted.page.assetUrl(asset));
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

/** Reads the pictures of the shown page that the index has no words for. */
async function scan(mounted: MountedPage, current: () => boolean): Promise<void> {
  const extras = maybeSearchClient()?.extras;
  if (!extras) return;
  const page = mounted.page.id;
  const known = new Set((await extras.mediaBlocks(page)).map((entry) => entry.block));
  for (const block of mounted.layer.blocks()) {
    if (!current()) return;
    const asset = typeof block.data.asset === 'string' ? block.data.asset : null;
    const key = `${page}/${block.id}`;
    if (block.type !== 'image' || !asset || known.has(block.id) || scanned.has(key)) continue;
    if ((failures.get(key) ?? 0) >= MAX_FAILURES) continue;
    const api = await loadApi();
    if (!(await api.searchTextReady('image'))) return;
    const blob = await imageBlob(mounted, asset);
    if (!current()) return;
    if (!blob) {
      failures.set(key, (failures.get(key) ?? 0) + 1);
      continue;
    }
    const found = await api.searchTextInImage(blob);
    if (!found) {
      failures.set(key, (failures.get(key) ?? 0) + 1);
      continue;
    }
    scanned.add(key);
    await indexMediaText({ page, block: block.id, kind: 'image', text: found.text.trim() || NO_WORDS });
  }
}

/** How often the shown page is looked at again, so a picture pasted into it is read within a minute. */
const RESCAN_MS = 10_000;

/** Watches the shown page and reads its pictures. Returns a function that stops. */
export function startMediaIndexer(): () => void {
  if (!isEnabled('search.indexMedia') || !isEnabled('intel.searchText')) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let again: ReturnType<typeof setInterval> | null = null;
  let scanning = false;
  const run = (mounted: MountedPage) => {
    if (scanning) return;
    scanning = true;
    void scan(mounted, () => shownMounted.get() === mounted)
      .catch(() => undefined)
      .finally(() => {
        scanning = false;
      });
  };
  const stop = shownMounted.subscribe(() => {
    if (timer) clearTimeout(timer);
    if (again) clearInterval(again);
    again = null;
    const mounted = shownMounted.get();
    if (!mounted) return;
    timer = setTimeout(() => run(mounted), START_DELAY_MS);
    again = setInterval(() => run(mounted), RESCAN_MS);
  });
  return () => {
    stop();
    if (timer) clearTimeout(timer);
    if (again) clearInterval(again);
  };
}
