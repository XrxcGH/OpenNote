// Measuring and slicing the measure document in a browser. Lines are a product of layout, so the only way to find them
// is to ask the DOM: it gives the box of every line of text and every table row, and the place in the text where each
// line starts. The same code can measure the page view for the paginator. It needs a live document and nothing else.

import type { Rect } from '../pagination/geometry';
import type { BlockMeasure, Box } from '../pagination/types';

/** A line box from one run of text on one line. */
interface Fragment {
  readonly seq: number;
  readonly top: number;
  readonly bottom: number;
  readonly node: Text;
  readonly offset: number;
}

interface LineStart {
  readonly node: Text;
  readonly offset: number;
}

interface Lines {
  readonly boxes: Box[];
  readonly starts: LineStart[];
}

function lineHeightOf(el: Element): number {
  const style = getComputedStyle(el);
  const value = parseFloat(style.lineHeight);
  return Number.isFinite(value) ? value : parseFloat(style.fontSize) * 1.2;
}

/** The text nodes of an element that show something, in document order. */
function textNodes(root: Element): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n as Text).data.trim() !== '') nodes.push(n as Text);
  }
  return nodes;
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

function fragmentsOf(node: Text, seq: { n: number }, origin: DOMRect): Fragment[] {
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
  const lh = node.parentElement ? lineHeightOf(node.parentElement) : 0;
  return rects.map((r, i) => {
    const mid = (r.top + r.bottom) / 2 - origin.top;
    seq.n += 1;
    return { seq: seq.n, top: mid - lh / 2, bottom: mid + lh / 2, node, offset: startOffset(node, i, rects) };
  });
}

/** Groups fragments that share a line: their boxes overlap by more than half of the smaller one. */
function clusterLines(fragments: readonly Fragment[]): Fragment[][] {
  const sorted = [...fragments].sort((a, b) => a.top - b.top || a.seq - b.seq);
  const clusters: { top: number; bottom: number; members: Fragment[] }[] = [];
  for (const f of sorted) {
    const last = clusters.at(-1);
    const overlap = last ? Math.min(last.bottom, f.bottom) - Math.max(last.top, f.top) : 0;
    const smaller = last ? Math.min(last.bottom - last.top, f.bottom - f.top) : 0;
    if (last && overlap > smaller / 2) {
      last.top = Math.min(last.top, f.top);
      last.bottom = Math.max(last.bottom, f.bottom);
      last.members.push(f);
    } else clusters.push({ top: f.top, bottom: f.bottom, members: [f] });
  }
  return clusters.map((c) => c.members);
}

/** The lines of an element: a box for each, and where in the text it starts. */
function linesOf(content: Element, origin: DOMRect): Lines {
  const seq = { n: 0 };
  const fragments = textNodes(content).flatMap((n) => fragmentsOf(n, seq, origin));
  const boxes: Box[] = [];
  const starts: LineStart[] = [];
  for (const members of clusterLines(fragments)) {
    const first = members.reduce((a, b) => (b.seq < a.seq ? b : a));
    const top = Math.min(...members.map((m) => m.top));
    const bottom = Math.max(...members.map((m) => m.bottom));
    boxes.push({ top, height: bottom - top });
    starts.push({ node: first.node, offset: first.offset });
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

  constructor(private readonly root: HTMLElement) {}

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
      const lines = linesOf(content, origin);
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
   * element above the range are copied around it, so the slice keeps its list, quote, or code block.
   */
  slice(id: string, from: number, to: number): string {
    const el = this.unit(id);
    const content = el?.firstElementChild;
    const lines = this.lines.get(id);
    if (!el || !content || !lines) return el?.innerHTML ?? '';
    const range = document.createRange();
    const start = lines.starts[from];
    range.setStart(start.node, start.offset);
    const end = lines.starts[to];
    if (end) range.setEnd(end.node, end.offset);
    else range.setEndAfter(content.lastChild ?? content);
    const wrapper = wrapFragment(range, content);
    if (/^(UL|OL)$/.test(content.tagName)) fixList(content, start, wrapper);
    return wrapper.outerHTML;
  }
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

/** Waits until the fonts and images of a document are ready, so measuring sees the final layout. */
export async function settle(doc: Document): Promise<void> {
  await doc.fonts?.ready;
  const pending = Array.from(doc.images, (img) => (img.complete ? null : img.decode().catch(() => undefined)));
  await Promise.all(pending);
}
