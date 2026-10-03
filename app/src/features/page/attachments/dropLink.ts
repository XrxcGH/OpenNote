// Links dropped from a browser: dragging a link or an address from a browser onto a page
// makes a link, with the link's own text when the browser sent it. Files go through attach.ts.

export interface DroppedLink {
  href: string;
  title: string;
}

const BARE = /^https?:\/\/[^\s<>"]+$/i;

/** The text of a lone anchor in dragged HTML, or null when the HTML is anything else. */
function anchorText(html: string | null): { href: string; text: string } | null {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const anchors = doc.querySelectorAll('a[href]');
  if (anchors.length !== 1) return null;
  const anchor = anchors[0] as HTMLAnchorElement;
  const text = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();
  const rest = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text !== '' && text === rest ? { href: anchor.getAttribute('href') ?? '', text } : null;
}

/** A dropped web address as a link, or null when the drop is not one address. */
export function droppedLink(text: string | null, html: string | null): DroppedLink | null {
  const lone = anchorText(html);
  const candidate = (text ?? '').trim() || lone?.href || '';
  if (!BARE.test(candidate) || !URL.canParse(candidate)) return null;
  const title = lone && lone.href === candidate ? lone.text : (lone?.text ?? candidate);
  return { href: candidate, title: title.length > 200 ? candidate : title };
}

/** A link as Markdown, with the characters that would end its text escaped. */
export function linkMarkdown(link: DroppedLink): string {
  const title = link.title.replace(/[[\]\\]/g, (c) => `\\${c}`);
  const href = /[\s()<>\\]/.test(link.href) ? `<${link.href.replace(/[<>\\]/g, (c) => `\\${c}`)}>` : link.href;
  return `[${title}](${href})`;
}
