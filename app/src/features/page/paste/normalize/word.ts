// Word's clipboard HTML (Phase 4 design, 15.3 and 15.4). It is full of `mso-` styles, `<o:p>`, conditional comments,
// and lists written as paragraphs that carry `mso-list: l0 level2`. This rebuilds real nested lists and turns
// character styles into tags.
import { removeAll, rename, textOf } from '../dom';
import { mapColors } from './colors';
import { dropFormattingAttributes, dropUnwanted, fixNestedLists, styleToTags } from './common';

const LIST_STYLE = /mso-list\s*:\s*(?:l\d+\s+)?level(\d+)/i;
const ORDERED_MARKER = /^\(?(?:\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)]/;
const MARKER_SPAN = '[style*="mso-list" i]';

interface Frame {
  readonly level: number;
  readonly ordered: boolean;
  readonly list: HTMLElement;
}

/** The marker text of a list paragraph, which Word writes in a span marked `mso-list:Ignore`. */
function takeMarker(paragraph: HTMLElement): string {
  const span = Array.from(paragraph.querySelectorAll<HTMLElement>(MARKER_SPAN)).find((found) =>
    /mso-list\s*:\s*ignore/i.test(found.getAttribute('style') ?? ''),
  );
  const marker = span ? textOf(span) : '';
  span?.remove();
  return marker;
}

function levelOf(paragraph: HTMLElement): number | null {
  const match = LIST_STYLE.exec(paragraph.getAttribute('style') ?? '');
  return match ? Number(match[1]) : null;
}

/** Puts a new list where the paragraph is, or inside the last item of the list that holds it. */
function openList(paragraph: HTMLElement, parent: Frame | undefined, ordered: boolean, marker: string): HTMLElement {
  const list = paragraph.ownerDocument.createElement(ordered ? 'ol' : 'ul');
  const start = ordered ? Number.parseInt(marker, 10) : Number.NaN;
  if (start > 1) list.setAttribute('start', String(start));
  if (!parent) paragraph.before(list);
  else
    (parent.list.lastElementChild ?? parent.list.appendChild(paragraph.ownerDocument.createElement('li'))).append(list);
  return list;
}

function addItem(paragraph: HTMLElement, stack: Frame[]): void {
  const level = levelOf(paragraph) ?? 1;
  const marker = takeMarker(paragraph);
  const ordered = ORDERED_MARKER.test(marker);
  while (stack.length > 0 && stack[stack.length - 1].level > level) stack.pop();
  const top = stack.at(-1);
  if (top && top.level === level && top.ordered !== ordered) stack.pop();
  const parent = stack.at(-1);
  if (!parent || parent.level < level) {
    stack.push({ level, ordered, list: openList(paragraph, parent, ordered, marker) });
  }
  const item = paragraph.ownerDocument.createElement('li');
  item.append(...Array.from(paragraph.childNodes));
  (stack.at(-1) as Frame).list.append(item);
  paragraph.remove();
}

/** Rebuilds nested `ul` and `ol` from runs of list paragraphs, using their `mso-list` levels and marker text. */
export function rebuildLists(body: HTMLElement): void {
  const paragraphs = Array.from(body.querySelectorAll<HTMLElement>('p')).filter((p) => levelOf(p) !== null);
  const startsRun = paragraphs.map((p) => !paragraphs.includes(p.previousElementSibling as HTMLElement));
  let stack: Frame[] = [];
  paragraphs.forEach((paragraph, i) => {
    if (startsRun[i]) stack = [];
    addItem(paragraph, stack);
  });
}

/** Word's Title and Subtitle styles are the closest thing it has to headings. */
function renameTitles(body: HTMLElement): void {
  body.querySelectorAll('p.MsoTitle').forEach((title) => rename(title, 'h1'));
  body.querySelectorAll('p.MsoSubtitle').forEach((subtitle) => rename(subtitle, 'h2'));
}

export function normalizeWord(body: HTMLElement): void {
  dropUnwanted(body);
  removeAll(body, 'o\\:p');
  renameTitles(body);
  rebuildLists(body);
  fixNestedLists(body);
  mapColors(body);
  styleToTags(body);
  dropFormattingAttributes(body);
}
