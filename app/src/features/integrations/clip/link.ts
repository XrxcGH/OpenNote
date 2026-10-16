// The web clipper's fallback link, opennote://clip?url=<address>&title=<title> (extensions/clipper/lib/deeplink.js).
// The clipper opens it when the local API can't be reached. Any web page can open such a link too, so the app
// never acts on it alone: it offers to add a page with the title and the address to Quick notes, and adds it only
// when the person chooses Add. Nothing else in the link is read.
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';

export interface ClipLink {
  url: string;
  title: string;
}

const SHAPE = /^opennote:\/\/clip\/?\?(.*)$/i;
const MAX_LINK = 512;
const MAX_TITLE = 200;

/** The address and title in a clip link, or null when it isn't one or its address isn't a web address. */
export function parseClipLink(text: string): ClipLink | null {
  const trimmed = text.trim();
  if (trimmed.length > MAX_LINK) return null;
  const match = SHAPE.exec(trimmed);
  if (!match) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(match[1]);
  } catch {
    return null;
  }
  const url = params.get('url') ?? '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) return null;
  const title = [...(params.get('title') ?? '')]
    .map((char) => (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f ? ' ' : char))
    .join('')
    .trim()
    .slice(0, MAX_TITLE);
  return { url: parsed.href, title };
}

export interface ClipOfferDeps {
  /** Makes the page in Quick notes; resolves with its ID, or null. */
  quickNote(title: string, url: string): Promise<string | null>;
  open(pageId: string): void;
}

/** Offers to add the clipped page; true when the text was a clip link. */
export function offerClip(text: string, deps: ClipOfferDeps): boolean {
  const link = parseClipLink(text);
  if (!link) return false;
  const title = link.title || new URL(link.url).hostname;
  showToast({
    message: t('platformApi.clipLink.offer', { title }),
    action: {
      label: t('platformApi.clipLink.add'),
      run: () =>
        void deps.quickNote(title, link.url).then((page) => {
          if (!page) {
            showToast({ message: t('platformApi.clipLink.failed'), tone: 'danger' });
            return;
          }
          showToast({
            message: t('platformApi.clipLink.added'),
            action: { label: t('platformApi.share.open'), run: () => deps.open(page) },
          });
        }),
    },
  });
  return true;
}
