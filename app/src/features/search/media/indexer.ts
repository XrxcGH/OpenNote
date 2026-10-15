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
import { INK_BLOCK, TRANSCRIPT_TYPE, indexInk, inkKnown, transcriptText } from './handwriting';
import { shownStrokes } from '../../page';

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
const transcripts = new Map<string, string>();

async function imageBlob(mounted: MountedPage, asset: string): Promise<Blob | null> {
  try {
    const response = await fetch(mounted.page.assetUrl(asset));
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

/** Reads the page's pictures, handwriting and transcripts that the index has no current words for. */
async function scan(mounted: MountedPage, current: () => boolean): Promise<void> {
  const extras = maybeSearchClient()?.extras;
  if (!extras) return;
  const page = mounted.page.id;
  const known = new Set((await extras.mediaBlocks(page)).map((entry) => entry.block));
  let imagesReady = true;
  for (const block of mounted.layer.blocks()) {
    if (!current()) return;
    const key = `${page}/${block.id}`;
    if (block.type === TRANSCRIPT_TYPE) {
      const text = transcriptText(block.data);
      if (text && transcripts.get(key) !== text) {
        if (await indexMediaText({ page, block: block.id, kind: 'transcript', text })) transcripts.set(key, text);
      }
      continue;
    }
    const asset = typeof block.data.asset === 'string' ? block.data.asset : null;
    if (!imagesReady || block.type !== 'image' || !asset || known.has(block.id) || scanned.has(key)) continue;
    const api = await loadApi();
    if (!(await api.searchTextReady('image'))) {
      imagesReady = false;
      continue;
    }
    const blob = await imageBlob(mounted, asset);
    if (!blob || !current()) continue;
    const found = await api.searchTextInImage(blob);
    if (!found) continue;
    scanned.add(key);
    await indexMediaText({ page, block: block.id, kind: 'image', text: found.text.trim() || NO_WORDS });
  }
  if (current()) await scanInk(page, known.has(INK_BLOCK));
}

/** Reads the shown page's handwriting for the index. Quiet when the feature is off. */
async function scanInk(page: string, indexed: boolean): Promise<void> {
  if (shownStrokes().length === 0 && !indexed && !inkKnown(page)) return;
  const api = await loadApi();
  if (!(await api.searchTextReady('handwriting'))) return;
  await indexInk(page, {
    strokes: () => shownStrokes().map((stroke) => ({ id: stroke.id, points: stroke.points })),
    read: async (strokes) => {
      const found = await api.searchTextInInk(strokes);
      return found && { text: found.text, words: found.words };
    },
    index: indexMediaText,
  });
}

/** Watches the shown page and reads its pictures. Returns a function that stops. */
export function startMediaIndexer(): () => void {
  if (!isEnabled('search.indexMedia') || !isEnabled('intel.searchText')) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = shownMounted.subscribe(() => {
    if (timer) clearTimeout(timer);
    const mounted = shownMounted.get();
    if (!mounted) return;
    timer = setTimeout(() => {
      void scan(mounted, () => shownMounted.get() === mounted).catch(() => undefined);
    }, START_DELAY_MS);
  });
  return () => {
    stop();
    if (timer) clearTimeout(timer);
  };
}
