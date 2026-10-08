// opennote:// links (Phase 8, Links to paragraphs). A link names a page by its ID, and a heading or paragraph by
// the ID of its element, so it survives renames and moves. The links come from outside the app too (Outlook, Word,
// Teams, a browser), so reading one accepts nothing but these two shapes and only ever opens a page.
export const LINK_SCHEME = 'opennote://';

export interface OpenNoteLink {
  page: string;
  /** A block or an element in the page. */
  target: string | null;
}

const SAFE_ID = /^[A-Za-z0-9_-]{6,64}$/;
const SHAPE = /^opennote:\/\/page\/([^/?#]+)(?:\/([^/?#]+))?\/?(?:[?#].*)?$/i;

/** `opennote://page/<page>` or `opennote://page/<page>/<target>`. */
export function formatLink(page: string, target?: string | null): string {
  const base = `${LINK_SCHEME}page/${encodeURIComponent(page)}`;
  return target ? `${base}/${encodeURIComponent(target)}` : base;
}

/** The link in the text, or null when it is not an OpenNote link or its IDs look wrong. */
export function parseLink(text: string): OpenNoteLink | null {
  const match = SHAPE.exec(text.trim());
  if (!match) return null;
  try {
    const page = decodeURIComponent(match[1]);
    const target = match[2] === undefined ? null : decodeURIComponent(match[2]);
    if (!SAFE_ID.test(page) || (target !== null && !SAFE_ID.test(target))) return null;
    return { page, target };
  } catch {
    return null;
  }
}

/** The first OpenNote link among launch arguments. */
export function linkInArgs(args: readonly string[]): OpenNoteLink | null {
  for (const arg of args) {
    const link = parseLink(arg);
    if (link) return link;
  }
  return null;
}
