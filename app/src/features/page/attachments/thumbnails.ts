// First-page thumbnails for attached PDF and Office files. Windows draws them (see page_extras/thumbnail.rs), so
// the shell is asked once per attached version and the picture is kept as long as the window is open. Where Windows
// has no picture, or the page runs outside the desktop app, the card keeps its icon.
import { commandContext } from '../../../commands/registry';
import { extensionOf, fileKind } from './model';

const SIZE = 192;
const cache = new Map<string, Promise<string | null>>();

/** Whether a file of this name is a PDF or an Office document, the kinds that get a thumbnail. */
export function wantsThumbnail(name: string): boolean {
  const family = fileKind(name).family;
  return (
    (family === 'pdf' || family === 'word' || family === 'excel' || family === 'powerpoint') &&
    extensionOf(name) !== 'csv'
  );
}

/** A blob URL of the file's thumbnail, or null. One request per asset, however many cards show it. */
export function thumbnailUrl(page: string, asset: string, name: string): Promise<string | null> {
  if (!wantsThumbnail(name)) return Promise.resolve(null);
  const key = `${page}/${asset}`;
  let found = cache.get(key);
  if (!found) {
    found = (async () => {
      try {
        const bytes = await commandContext('menu').platform.pageExtras.attachmentThumbnail(page, asset, name, SIZE);
        if (!bytes || bytes.byteLength === 0) return null;
        return URL.createObjectURL(new Blob([bytes.slice()], { type: 'image/png' }));
      } catch {
        return null;
      }
    })();
    cache.set(key, found);
  }
  return found;
}

/** Forgets the thumbnails of a page that closed, and frees their pictures. */
export function forgetThumbnails(page: string): void {
  for (const [key, url] of cache) {
    if (!key.startsWith(`${page}/`)) continue;
    cache.delete(key);
    void url.then((value) => value && URL.revokeObjectURL(value));
  }
}
