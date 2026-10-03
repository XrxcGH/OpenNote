// Web pages (Phase 4 ARCHITECTURE.md sections 15.3 and 15.4): structure stays, and fonts, colors, classes, page
// chrome, hidden elements, and tracking pixels go. Relative links resolve against the source address.
import { removeAll, rename, unwrap } from '../dom';
import type { PasteInput } from '../types';
import { breaksToNewlines, dropUnwanted, fixNestedLists } from './common';

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
