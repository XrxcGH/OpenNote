// Reading the text in new images in the background (Phase 12). A page that shows an image the device hasn't read yet
// adds a job to the activity panel's queue. The words are kept on this device, so search can use them without reading
// the image again. It never asks to turn text recognition on: with the switch off, nothing is read. Nothing is read or
// kept for an image of a protected page (protectedPages.ts), and what was kept goes, on disk too, when its page
// becomes protected.
import { isIntelError } from '../../../services/intel';
import { isOn } from '../choices';
import { readTextInImage, textOfResult } from '../imageText';
import { isProtectedPage, onPagesProtected } from '../protectedPages';
import { intelExt } from '../runtime';
import { enqueueBackground } from './index';

const FILE = 'image-text.json';
/** The most text kept for one image, in UTF-16 units. */
export const MAX_KEPT_CHARS = 20_000;
/** The most images kept. The oldest go first. */
export const MAX_KEPT_IMAGES = 2000;

interface Kept {
  text: string;
  at: number;
}

let kept: Map<string, Kept> | null = null;
let loading: Promise<Map<string, Kept>> | null = null;
const listeners = new Set<(key: string, text: string) => void>();
const queued = new Set<string>();

/** The page an image key names, when it names one. */
export function pageOfImageKey(key: string): string | null {
  const slash = key.indexOf('/');
  return slash > 0 && !key.includes(':') ? key.slice(0, slash) : null;
}

const isProtectedKey = (key: string): boolean => {
  const page = pageOfImageKey(key);
  return page !== null && isProtectedPage(page);
};

/** Drops the words of images on the pages, and saves when any went. */
async function forgetPages(pages: ReadonlySet<string>): Promise<void> {
  const map = await table();
  let dropped = false;
  for (const key of [...map.keys()]) {
    const page = pageOfImageKey(key);
    if (page !== null && pages.has(page)) dropped = map.delete(key) || dropped;
  }
  if (dropped) await save(map);
}

onPagesProtected((ids) => forgetPages(new Set(ids)));

async function table(): Promise<Map<string, Kept>> {
  if (kept) return kept;
  loading ??= (async () => {
    let dropped = false;
    let map = new Map<string, Kept>();
    try {
      const text = await (await intelExt()).get(FILE);
      const entries = Object.entries(text ? (JSON.parse(text) as Record<string, Kept>) : {});
      const allowed = entries.filter(([key]) => !isProtectedKey(key));
      dropped = allowed.length < entries.length;
      map = new Map(allowed);
    } catch {
      // Nothing was kept, or it can't be read: the images are read again.
    }
    kept = map;
    // Words of a page that is protected now are written out of the file at once.
    if (dropped) await save(map);
    return map;
  })();
  return loading;
}

/** Whether any words of images are kept on this device. */
export async function hasImageText(): Promise<boolean> {
  return (await table()).size > 0;
}

async function save(map: Map<string, Kept>): Promise<void> {
  const overflow = map.size - MAX_KEPT_IMAGES;
  if (overflow > 0) {
    const oldest = [...map.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, overflow);
    for (const [key] of oldest) map.delete(key);
  }
  for (const key of [...map.keys()]) if (isProtectedKey(key)) map.delete(key);
  try {
    await (await intelExt()).put(FILE, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // The words stay for this session.
  }
}

/** The key for an image: its page and asset when the address names them, and the address otherwise. */
export function imageKey(src: string): string {
  try {
    const url = new URL(src);
    if (url.hostname.endsWith('opennote-asset.localhost')) {
      return url.pathname.replace(/^\//, '').split('/').map(decodeURIComponent).join('/');
    }
  } catch {
    // An address that isn't a URL is its own key.
  }
  return src;
}

/** The words read in an image, or null when it hasn't been read. */
export async function getImageText(key: string): Promise<string | null> {
  return (await table()).get(key)?.text ?? null;
}

/** Calls back whenever the words of an image are read. For search, to index them. */
export function onImageText(listener: (key: string, text: string) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Queues the image for reading unless it was read or is waiting. Returns whether a job was added. */
export async function queueImageText(src: string, label: string): Promise<boolean> {
  if (!isOn('ocr')) return false;
  const key = imageKey(src);
  if (isProtectedKey(key) || queued.has(key) || (await table()).has(key)) return false;
  queued.add(key);
  const added = await enqueueBackground({
    id: `imageText:${key}`,
    kind: 'imageText',
    label,
    automatic: true,
    run: async (signal) => {
      try {
        const response = await fetch(src, { signal });
        if (!response.ok) throw new Error(`The image answered ${response.status}.`);
        const text = textOfResult(await readTextInImage(await response.blob())).slice(0, MAX_KEPT_CHARS);
        // The page may have become protected while the image was read.
        if (isProtectedKey(key)) return;
        const map = await table();
        map.set(key, { text, at: Date.now() });
        await save(map);
        listeners.forEach((listener) => listener(key, text));
      } catch (error) {
        // A feature that was turned off or has no language pack stops quietly. Anything else can be tried again.
        if (isIntelError(error, 'disabled') || isIntelError(error, 'languageUnavailable')) return;
        throw error;
      } finally {
        queued.delete(key);
      }
    },
  });
  if (!added) queued.delete(key);
  return added;
}

/** Queues every image under `root` now and each one added later. Returns the function that stops watching. */
export function watchImagesForText(root: HTMLElement, label: (img: HTMLImageElement) => string): () => void {
  const scan = (from: ParentNode) => {
    from.querySelectorAll('img').forEach((img) => {
      if (img.src) void queueImageText(img.src, label(img));
    });
  };
  scan(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof HTMLImageElement && node.src) void queueImageText(node.src, label(node));
        else if (node instanceof Element) scan(node);
      });
      if (record.type === 'attributes' && record.target instanceof HTMLImageElement && record.target.src) {
        void queueImageText(record.target.src, label(record.target));
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  return () => observer.disconnect();
}

/** Tests start with nothing read. */
export function resetImageTextForTests(): void {
  kept = null;
  loading = null;
  queued.clear();
  listeners.clear();
}
