// The fallback when the local API can't be reached: an opennote://clip link that Windows hands to OpenNote, which
// adds a page with the address and title to Quick notes. The app accepts links of up to 512 characters made only
// of a few safe characters (app/src-tauri/src/deeplink.rs), so the title is shortened to fit and every other
// character is percent-encoded.

export const CLIP_LINK = 'opennote://clip';
const MAX_LINK = 512;

/** Percent-encodes everything but letters, digits, and `-_.`. */
export function strictEncode(text) {
  return encodeURIComponent(text).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The opennote://clip link for a page, or null when its address is too long for a link. */
export function clipLink(url, title) {
  if (!/^https?:\/\//i.test(url ?? '')) return null;
  const base = `${CLIP_LINK}?url=${strictEncode(url)}`;
  if (base.length > MAX_LINK) return null;
  let words = String(title ?? '').trim();
  while (words) {
    const link = `${base}&title=${strictEncode(words)}`;
    if (link.length <= MAX_LINK) return link;
    words = words.slice(0, Math.floor(words.length * 0.8)).trimEnd();
  }
  return base;
}
