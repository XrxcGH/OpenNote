// Measuring and slicing the measure document in a browser. Lines are a product of layout, so the only way to find them
// is to ask the DOM: it gives the box of every line of text and every table row, and the place in the text where each
// line starts. The same code can measure the page view for the paginator. It needs a live document and nothing else.

import type { RuleGrid } from '../../../core/ruled';
import type { Rect } from '../pagination/geometry';
import type { BlockMeasure, Box } from '../pagination/types';

/** A place in the DOM where a line starts: in a text node, or before a picture or a task box. */
export interface LineStart {
  readonly node: Node;
  readonly offset: number;
}

/** A box on one line: one run of text, or one picture or task box. */
interface Fragment {
  readonly seq: number;
  readonly top: number;
  readonly bottom: number;
  readonly start: LineStart;
}

/** Inline elements that take room on a line with no text in them. */
const REPLACED = 'img, svg, .box';
/** Controls an editor draws over its text, such as a code block's language button: they are not lines of text. */
const CONTROLS = 'button';

export interface Lines {
  readonly boxes: Box[];
  readonly starts: LineStart[];
}

function lineHeightOf(el: Element): number {
  const style = getComputedStyle(el);
  const value = parseFloat(style.lineHeight);
  return Number.isFinite(value) ? value : parseFloat(style.fontSize) * 1.2;
}

/** The text nodes that show something and the inline pictures and task boxes of an element, in document order. */
function piecesOf(root: Element): (Text | Element)[] {
  const pieces: (Text | Element)[] = [];
  const visit = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child instanceof Text) {
        if (child.data.trim() !== '') pieces.push(child);
      } else if (child instanceof Element) {
        if (child.matches(REPLACED)) pieces.push(child);
        else if (!child.matches(CONTROLS)) visit(child);
      }
    }
  };
  visit(root);
  return pieces;
}

/** The place right before a node, as its parent and index. */
function before(node: Node): LineStart {
  const parent = node.parentNode as Node;
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) };
}

/** The first rect of a character, or null when it takes no room, as a collapsed space does. */
function charTop(range: Range, node: Text, offset: number): number | null {
  range.setStart(node, offset);
  range.setEnd(node, offset + 1);
  const rect = Array.from(range.getClientRects()).find((r) => r.width > 0 || r.height > 0);
  return rect ? (rect.top + rect.bottom) / 2 : null;
}

/** The offset in a text node where its `line`th fragment begins, found by binary search over the characters. */
function startOffset(node: Text, line: number, rects: readonly DOMRect[]): number {
  if (line === 0) return 0;
  const range = document.createRange();
  const lineAt = (offset: number): number => {
    for (let o = offset; o < node.length; o += 1) {
      const mid = charTop(range, node, o);
      if (mid === null) continue;
      const nearest = rects.reduce(
        (best, r, i) => {
          const d = Math.abs((r.top + r.bottom) / 2 - mid);
          return d < best.d ? { i, d } : best;
        },
        { i: 0, d: Infinity },
      );
      return nearest.i;
    }
    return rects.length - 1;
  };
  let lo = 0;
  let hi = node.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lineAt(mid) >= line) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * The fragments of a run of text, one for each line it is on, each as tall as its line height. Text in `sub` and `sup`
 * has a line height of 0, so a fragment is never less tall than the glyphs that show.
 */
function textFragments(node: Text, seq: { n: number }, origin: DOMRect): Fragment[] {
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
  const lh = node.parentElement ? lineHeightOf(node.parentElement) : 0;
  return rects.map((r, i) => {
    const mid = (r.top + r.bottom) / 2 - origin.top;
    const half = Math.max(lh, r.height) / 2;
    seq.n += 1;
    return { seq: seq.n, top: mid - half, bottom: mid + half, start: { node, offset: startOffset(node, i, rects) } };
  });
}

/** A picture or task box on a line, as tall as it is drawn. A tall picture makes its whole line that tall. */
function elementFragment(el: Element, seq: { n: number }, origin: DOMRect): Fragment[] {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return [];
  seq.n += 1;
  return [{ seq: seq.n, top: r.top - origin.top, bottom: r.bottom - origin.top, start: before(el) }];
}

/**
 * Groups fragments that share a line. A fragment joins the line so far when their boxes overlap by more than half of
 * the smaller one, or when its middle lies inside the line, as a raised or lowered run of text does.
 */
function clusterLines(fragments: readonly Fragment[]): Fragment[][] {
  const sorted = [...fragments].sort((a, b) => a.top - b.top || a.seq - b.seq);
  const clusters: { top: number; bottom: number; members: Fragment[] }[] = [];
  for (const f of sorted) {
    const last = clusters.at(-1);
    const overlap = last ? Math.min(last.bottom, f.bottom) - Math.max(last.top, f.top) : 0;
    const smaller = last ? Math.min(last.bottom - last.top, f.bottom - f.top) : 0;
    const mid = (f.top + f.bottom) / 2;
    if (last && (overlap > smaller / 2 || (mid > last.top && mid < last.bottom))) {
      last.top = Math.min(last.top, f.top);
      last.bottom = Math.max(last.bottom, f.bottom);
      last.members.push(f);
    } else clusters.push({ top: f.top, bottom: f.bottom, members: [f] });
  }
  return clusters.map((c) => c.members);
}

/** How far below its baseline a line's glyphs reach, as a fraction of the text size. Enough to find the baseline. */
const DESCENT = 0.24;

/**
 * The line cell a line of text has on ruled paper: a whole number of rules tall, with the baseline on its bottom rule.
 * The paginator places cells, not the glyph boxes in them, so a line that starts a sheet puts its cell on the sheet's
 * first rule and its baseline on the rule below. `box` is in page units from the same top as `rules.origin`.
 */
export function ruledCell(box: Box, element: Element, rules: RuleGrid): Box {
  const style = getComputedStyle(element);
  const height = Number.parseFloat(style.lineHeight);
  const size = Number.parseFloat(style.fontSize);
  if (!Number.isFinite(height) || !Number.isFinite(size)) return box;
  const n = Math.max(1, Math.round(height / rules.step));
  const baseline = box.top + box.height - DESCENT * size;
  const rule = Math.round((baseline - rules.origin) / rules.step);
  return { top: rules.origin + (rule - n) * rules.step, height: n * rules.step };
}

/** The lines of an element: a box for each, and where in the text it starts. */
export function linesOf(content: Element, origin: DOMRect): Lines {
  const seq = { n: 0 };
  const fragments = piecesOf(content).flatMap((piece) =>
    piece instanceof Text ? textFragments(piece, seq, origin) : elementFragment(piece, seq, origin),
  );
  const boxes: Box[] = [];
  const starts: LineStart[] = [];
  for (const members of clusterLines(fragments)) {
    const first = members.reduce((a, b) => (b.seq < a.seq ? b : a));
    const top = Math.min(...members.map((m) => m.top));
    const bottom = Math.max(...members.map((m) => m.bottom));
    boxes.push({ top, height: bottom - top });
    starts.push(first.start);
  }
  return { boxes, starts };
}

const rel = (r: DOMRect, origin: DOMRect): Box => ({ top: r.top - origin.top, height: r.height });

export interface UnitMeasure extends BlockMeasure {
  /** The top of the first line or row, or of the unit itself when it has neither. */
  readonly first: number;
}

/** Reads a measure document made by `measureDocument`. */
export class FlowMeasurer {
  private readonly lines = new Map<string, Lines>();

  constructor(
    private readonly root: HTMLElement,
    /** The rules of ruled paper: lines are then the cells they sit in. */
    private readonly rules: RuleGrid | null = null,
  ) {}

  private unit(id: string): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(`[data-unit="${CSS.escape(id)}"]`);
  }

  private origin(): DOMRect {
    return this.root.getBoundingClientRect();
  }

  /** The unit's box, its lines or rows, and where its first line starts. */
  measure(id: string): UnitMeasure {
    const el = this.unit(id);
    if (!el) return { top: 0, height: 0, first: 0 };
    const origin = this.origin();
    const box = rel(el.getBoundingClientRect(), origin);
    const kind = el.dataset.kind;
    const content = el.firstElementChild;
    if (kind === 'text' && content) {
      const found = linesOf(content, origin);
      const lines = this.rules
        ? { ...found, boxes: found.boxes.map((line) => ruledCell(line, content, this.rules!)) }
        : found;
      this.lines.set(id, lines);
      if (lines.boxes.length > 0) return { ...box, lines: lines.boxes, first: lines.boxes[0].top };
    }
    if (kind === 'table' && content) {
      const rows = Array.from(content.querySelectorAll('tr'), (tr) => rel(tr.getBoundingClientRect(), origin));
      if (rows.length > 0) return { ...box, rows, first: rows[0].top };
    }
    // A block that never splits ends where its content does, not where its last margin does.
    const inner = content ? rel(content.getBoundingClientRect(), origin) : box;
    return { top: box.top, height: Math.max(0, inner.top + inner.height - box.top), first: box.top };
  }

  /** The place each floating block occupies, unrotated, by block ID. */
  floatRects(): Map<string, Rect> {
    const rects = new Map<string, Rect>();
    for (const el of this.root.querySelectorAll<HTMLElement>('.float[data-block]')) {
      rects.set(el.dataset.block as string, {
        x: el.offsetLeft,
        y: el.offsetTop,
        w: el.offsetWidth,
        h: el.offsetHeight,
      });
    }
    return rects;
  }

  /**
   * The part of a text unit from line `from` up to, not including, line `to`, as HTML. The unit's own element and every
   * element above the range are copied around it, so the slice keeps its list, quote, or code block. An element that
   * a line starts goes whole to the slice that line begins. So no slice ends with an empty list item, and a task box
   * or a picture at the start of a line stays with it.
   */
  slice(id: string, from: number, to: number): string {
    const el = this.unit(id);
    const content = el?.firstElementChild;
    const lines = this.lines.get(id);
    if (!el || !content || !lines) return el?.innerHTML ?? '';
    const range = document.createRange();
    const start = lines.starts[from];
    const first = from === 0 ? { node: content, offset: 0 } : hoist(start, content);
    range.setStart(first.node, first.offset);
    const end = lines.starts[to];
    if (end) {
      const last = hoist(end, content);
      range.setEnd(last.node, last.offset);
    } else range.setEndAfter(content.lastChild ?? content);
    const wrapper = wrapFragment(range, content);
    if (/^(UL|OL)$/.test(content.tagName)) fixList(content, start, wrapper);
    return wrapper.outerHTML;
  }
}

/** True when nothing shows in an element before a place in it: no text, picture, or task box. */
function nothingBefore(el: Element, at: LineStart): boolean {
  const range = document.createRange();
  range.setStart(el, 0);
  range.setEnd(at.node, at.offset);
  return range.toString().trim() === '' && !range.cloneContents().querySelector(REPLACED);
}

/**
 * Moves a place out of each element below `content` that it is at the very start of, to right before that element.
 * A range from or to that place then holds the element whole or not at all, never a copy cut at its start.
 */
function hoist(at: LineStart, content: Element): LineStart {
  let place = at;
  let el = at.node instanceof Element ? at.node : at.node.parentElement;
  while (el && el !== content && content.contains(el) && nothingBefore(el, place)) {
    place = before(el);
    el = el.parentElement;
  }
  return place;
}

/** Copies the range's contents inside shallow copies of its ancestors up to and including `content`. */
function wrapFragment(range: Range, content: Element): Element {
  let node: Node = range.cloneContents();
  let ancestor: Node | null = range.commonAncestorContainer;
  if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentNode;
  while (ancestor) {
    const copy = ancestor.cloneNode(false);
    copy.appendChild(node);
    node = copy;
    if (ancestor === content) break;
    ancestor = ancestor.parentNode;
  }
  return node as Element;
}

/** True when the text of an element before a position is not empty, so the position is inside the item, not at its start. */
function textBefore(el: Element, start: LineStart): boolean {
  const range = document.createRange();
  range.setStart(el, 0);
  range.setEnd(start.node, start.offset);
  return range.toString().trim() !== '';
}

const isList = (el: Element): boolean => el.tagName === 'UL' || el.tagName === 'OL';
const itemsOf = (list: Element): Element[] => Array.from(list.children).filter((c) => c.tagName === 'LI');

/**
 * Keeps a list that was cut in the middle numbered and bulleted right: the numbered list starts at the item it was cut
 * in, and an item that continues from the sheet before shows no marker. This handles the list that is the unit itself.
 */
function fixList(original: Element, start: LineStart, wrapper: Element): void {
  let list: Element | null = original;
  let copy: Element | null = wrapper;
  while (list && copy) {
    const items: Element[] = itemsOf(list);
    const index = items.findIndex((li) => li.contains(start.node));
    if (index < 0) return;
    if (list.tagName === 'OL') copy.setAttribute('start', String((Number(list.getAttribute('start')) || 1) + index));
    const copyItem: Element | undefined = itemsOf(copy)[0];
    if (!copyItem) return;
    if (textBefore(items[index], start)) copyItem.classList.add('cont');
    const nested: Element | undefined = Array.from(items[index].children).find(
      (c) => isList(c) && c.contains(start.node),
    );
    list = nested ?? null;
    copy = nested ? (Array.from(copyItem.children).find(isList) ?? null) : null;
  }
}

/** How long `settle` waits for the fonts, and for each image, in milliseconds. */
export const SETTLE_WAIT = 10_000;

/** Waits for the promise, or for `ms`, whichever ends first. Either way it resolves. */
async function within(work: Promise<unknown> | undefined, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)));
  try {
    await Promise.race([work?.catch(() => undefined), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Waits until the fonts and images of a document are ready, so measuring sees the final layout. An image that never
 * loads is given up on after `wait` milliseconds, and measured as it stands.
 */
export async function settle(doc: Document, wait = SETTLE_WAIT): Promise<void> {
  await within(doc.fonts?.ready, wait);
  await Promise.all(Array.from(doc.images, (img) => (img.complete ? null : within(img.decode(), wait))));
}
