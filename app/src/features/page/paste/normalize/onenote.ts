// OneNote's clipboard HTML (Phase 4 ARCHITECTURE.md sections 15.3 and 15.4): outline `div`s, real lists, To Do tags
// as small images whose description names them, and colors in styles. A pure function from an inert body to itself.
import { mapColors } from './colors';
import { dropFormattingAttributes, dropUnwanted, fixNestedLists, styleToTags } from './common';

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
  mapColors(body);
  styleToTags(body);
  dropFormattingAttributes(body);
}
