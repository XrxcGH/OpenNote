// The smaller normalizers: OneNote, Google Docs, and web pages (Phase 4 design, 15.4). Each is a pure function from
// an inert document body to the same body, tested against captured fixtures.
import { removeAll, rename, unwrap } from '../dom';
import type { PasteInput } from '../types';
import { breaksToNewlines, dropFormattingAttributes, dropUnwanted, fixNestedLists, styleToTags } from './common';

/** OneNote writes a To Do tag as a small image whose description names it, and its state when it is checked. */
function todoState(alt: string): boolean | null {
  if (!/^\s*(?:to[\s-]?do|task|checkbox)\b/i.test(alt)) return null;
  return /\b(?:checked|done|complete|completed|ticked)\b/i.test(alt);
}

function asTaskItem(image: HTMLImageElement, checked: boolean): void {
  const host = image.closest('li, p, div');
  image.remove();
  if (!host) return;
  if (host.tagName === 'LI') {
    host.setAttribute('data-checked', String(checked));
    return;
  }
  const list = host.ownerDocument.createElement('ul');
  const item = host.ownerDocument.createElement('li');
  item.setAttribute('data-checked', String(checked));
  item.append(...Array.from(host.childNodes));
  list.append(item);
  host.replaceWith(list);
}

/** Outline `div`s need no flattening, because the schema reads them as plain containers. To Do tags become tasks. */
export function normalizeOneNote(body: HTMLElement): void {
  dropUnwanted(body);
  body.querySelectorAll('img').forEach((image) => {
    const state = todoState(image.getAttribute('alt') ?? '');
    if (state !== null) asTaskItem(image, state);
  });
  fixNestedLists(body);
  styleToTags(body);
  dropFormattingAttributes(body);
}

/** Google Docs wraps the whole paste in `<b id="docs-internal-guid-...">` and puts formatting in inline styles. */
export function normalizeGoogleDocs(body: HTMLElement): void {
  dropUnwanted(body);
  body.querySelectorAll('[id^="docs-internal-guid-"]').forEach(unwrap);
  removeAll(body, 'br.Apple-interchange-newline');
  fixNestedLists(body);
  styleToTags(body);
  dropFormattingAttributes(body);
}

const WEB_CHROME = 'nav, footer, aside, form, button, select, input, textarea, svg, canvas, video, audio, dialog';
const HIDDEN = '[hidden], [aria-hidden="true"]';
const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden/i;

function resolveUrl(value: string, base: string | null): string | null {
  try {
    return new URL(value, base ?? undefined).href;
  } catch {
    return null;
  }
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** An address as an absolute one, or null when it is relative and the page it came from is not known. */
function absolute(href: string, base: string | null): string | null {
  if (SCHEME.test(href)) return href;
  if (base === null || href.startsWith('#')) return null;
  return resolveUrl(href, base);
}

/** Makes link and image addresses absolute against the page they came from, and drops the ones that cannot be. */
function resolveAddresses(body: HTMLElement, base: string | null): void {
  for (const [selector, attribute] of [
    ['a[href]', 'href'],
    ['img[src]', 'src'],
  ] as const) {
    body.querySelectorAll(selector).forEach((element) => {
      const resolved = absolute(element.getAttribute(attribute) ?? '', base);
      if (resolved === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, resolved);
    });
  }
}

/** A checkbox at the start of a list item is a task item, as on GitHub. The checkbox is removed with the form controls. */
function markTaskBoxes(body: HTMLElement): void {
  body.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"]').forEach((box) => {
    box.parentElement?.setAttribute('data-checked', String(box.checked));
  });
}

/** A header that holds no heading is page chrome. One that holds a heading is an article's title, so it stays. */
function dropPageHeaders(body: HTMLElement): void {
  body.querySelectorAll('header').forEach((header) => {
    if (header.querySelector('h1, h2, h3, h4, h5, h6')) unwrap(header);
    else header.remove();
  });
}

/**
 * Web pages keep structure (headings, lists, quotes, code, tables, links, and images) and lose fonts, colors,
 * classes, and page chrome. A pasted selection may carry a tracking pixel, which is dropped too.
 */
export function normalizeWeb(body: HTMLElement, input: PasteInput): void {
  dropUnwanted(body);
  dropPageHeaders(body);
  markTaskBoxes(body);
  removeAll(body, WEB_CHROME);
  removeAll(body, HIDDEN);
  body.querySelectorAll('mark').forEach(unwrap);
  body.querySelectorAll('[style]').forEach((element) => {
    if (HIDDEN_STYLE.test(element.getAttribute('style') ?? '')) element.remove();
  });
  removeAll(body, 'img[width="1"], img[height="1"]');
  resolveAddresses(body, input.sourceUrl ?? null);
  fixNestedLists(body);
  breaksToNewlines(body);
  body.querySelectorAll('b[style]').forEach((element) => {
    if (/font-weight\s*:\s*(?:normal|400)/i.test(element.getAttribute('style') ?? '')) rename(element, 'span');
  });
}
