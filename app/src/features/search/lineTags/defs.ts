// The line tags (Phase 8). Nine tags sit on Ctrl+1 to Ctrl+9 in the OneNote set, as in
// OneNote. "To do" is a checkbox; the others are labels. Any other name is a custom tag. Every tag shows an icon and
// its name, never a color alone.
import { fold } from '../../../services/search/text';
import { t } from '../../../strings/t';

export const KNOWN_TAGS = [
  'todo',
  'important',
  'question',
  'idea',
  'remember',
  'definition',
  'highlight',
  'contact',
  'phone',
] as const;
export type KnownTag = (typeof KNOWN_TAGS)[number];

export const isKnownTag = (tag: string): tag is KnownTag => (KNOWN_TAGS as readonly string[]).includes(tag);

/** The tag on Ctrl+<slot>, for slots 1 to 9. */
export const tagForSlot = (slot: number): KnownTag => KNOWN_TAGS[slot - 1];

/** The checkbox tag. Its box is checked off in place. */
export const TODO = 'todo';

/** The tag as stored: folded, with no `#` and no empty parts, like the page tags. */
export function normalizeTag(tag: string): string {
  return fold(tag.trim().replace(/^#/, ''))
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

/** The name the person sees. */
export function tagName(tag: string): string {
  return isKnownTag(tag) ? t(`qolSearch.lineTags.names.${tag}`) : tag;
}

const ICONS: Record<KnownTag | 'custom', string> = {
  todo: 'M5 5h14v14H5z M8.5 12.5l2.5 2.5 4.5-5',
  important: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  question: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7 M12 17v.01',
  idea: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  remember: 'M7 4h10v16l-5-3.5L7 20z',
  definition: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h11',
  highlight: 'M4 20l4-1 11-11-3-3L5 16z M14 7l3 3',
  contact: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 20a8 8 0 0 1 16 0',
  phone: 'M6 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z',
  custom: 'M3 12V4h8l9 9-8 8z M7.5 8.5h.01',
};

/** A small outline icon for the tag, as an element for the editor's badge. */
export function tagIcon(tag: string, doc: Document = document): SVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[isKnownTag(tag) ? tag : 'custom']);
  svg.append(path);
  return svg;
}
