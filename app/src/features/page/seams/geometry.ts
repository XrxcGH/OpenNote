// Text geometry for Phase 5's anchors and spelling (ARCHITECTURE.md section 25.5; owner after WP0: WP3). It reads
// the shown page's DOM, so static and mounted blocks answer alike. Offsets count in the block's plain text: its
// text nodes joined, with nothing between blocks. Rectangles are in page units, through the camera.
import type { BlockId, PageRect } from '../../../services/pages/types';
import type { Point } from '../viewport/camera';

export interface TextGeometry {
  /** Page units, for static and mounted blocks alike. */
  lineBoxes(block: BlockId): readonly PageRect[];
  /** `offset` counts in the block's plain text. */
  rectForOffset(block: BlockId, offset: number): PageRect | null;
  /** Whole words, by Intl.Segmenter. */
  rangeAt(block: BlockId, point: Point): { from: number; to: number } | null;
  /** The same for static and mounted blocks. */
  plainText(block: BlockId): string;
}

/** Client coordinates to page units and back: the shown page's camera. */
export interface GeometryCamera {
  toWorld(clientX: number, clientY: number): Point;
  toClient(x: number, y: number): Point;
}

let source: ((block: BlockId) => HTMLElement | null) | null = null;
let camera: GeometryCamera | null = null;
const layoutListeners = new Map<BlockId, Set<() => void>>();

/** The shown page's block elements and camera; the page view sets them while a page is shown. */
export function setGeometrySource(next: ((block: BlockId) => HTMLElement | null) | null, cam?: GeometryCamera): void {
  source = next;
  camera = next ? (cam ?? null) : null;
}

/** The element whose text is the block's: its editing root, or the wrapper. */
function rootOf(block: BlockId): HTMLElement | null {
  const element = source?.(block) ?? null;
  return element?.querySelector<HTMLElement>('[data-block]') ?? element;
}

function textNodes(root: HTMLElement): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node as Text);
  return out;
}

/** The text node and offset in it for a plain-text offset. */
function locate(root: HTMLElement, offset: number): { node: Text; offset: number } | null {
  let left = offset;
  const nodes = textNodes(root);
  for (const node of nodes) {
    if (left <= node.length) return { node, offset: left };
    left -= node.length;
  }
  const last = nodes.at(-1);
  return last ? { node: last, offset: last.length } : null;
}

/** The plain-text offset of a DOM position inside `root`. */
function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  const range = root.ownerDocument.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

function toPage(rect: DOMRectReadOnly): PageRect {
  if (!camera) return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  const from = camera.toWorld(rect.left, rect.top);
  const to = camera.toWorld(rect.right, rect.bottom);
  return { x: from.x, y: from.y, w: to.x - from.x, h: to.y - from.y };
}

/** Client rectangles merged into one box per line. */
function lines(rects: readonly DOMRectReadOnly[]): DOMRect[] {
  const out: DOMRect[] = [];
  for (const rect of rects) {
    if (rect.width === 0 && rect.height === 0) continue;
    const line = out.find((other) => rect.top < other.bottom - 1 && other.top < rect.bottom - 1);
    if (!line) out.push(DOMRect.fromRect(rect));
    else {
      const left = Math.min(line.left, rect.left);
      const top = Math.min(line.top, rect.top);
      line.width = Math.max(line.right, rect.right) - left;
      line.height = Math.max(line.bottom, rect.bottom) - top;
      line.x = left;
      line.y = top;
    }
  }
  return out.sort((a, b) => a.top - b.top || a.left - b.left);
}

type CaretDocument = Document & {
  caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?(x: number, y: number): Range | null;
};

function caretAt(doc: CaretDocument, x: number, y: number): { node: Node; offset: number } | null {
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

export const textGeometry: TextGeometry = {
  lineBoxes(block) {
    const root = rootOf(block);
    if (!root) return [];
    // Text nodes only: a range over the root would also give each paragraph's whole box.
    const range = root.ownerDocument.createRange();
    const rects = textNodes(root).flatMap((node) => {
      range.selectNodeContents(node);
      return [...range.getClientRects()];
    });
    return lines(rects).map(toPage);
  },
  rectForOffset(block, offset) {
    const root = rootOf(block);
    const at = root ? locate(root, offset) : null;
    if (!root || !at) return null;
    const range = root.ownerDocument.createRange();
    range.setStart(at.node, at.offset);
    range.setEnd(at.node, Math.min(at.node.length, at.offset + 1));
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    return toPage(rect);
  },
  rangeAt(block, point) {
    const root = rootOf(block);
    if (!root) return null;
    const client = camera ? camera.toClient(point.x, point.y) : point;
    const caret = caretAt(root.ownerDocument as CaretDocument, client.x, client.y);
    if (!caret || !root.contains(caret.node)) return null;
    const offset = offsetOf(root, caret.node, caret.offset);
    const text = root.textContent ?? '';
    const words = new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text);
    for (const word of words) {
      const end = word.index + word.segment.length;
      if (word.isWordLike && offset >= word.index && offset <= end) return { from: word.index, to: end };
    }
    return null;
  },
  plainText: (block) => rootOf(block)?.textContent ?? '',
};

/** Runs after the block's DOM updates, before paint. */
export function onBlockLayout(block: BlockId, listener: () => void): () => void {
  const set = layoutListeners.get(block) ?? new Set();
  set.add(listener);
  layoutListeners.set(block, set);
  return () => void set.delete(listener);
}

/** The page view calls this after a block's DOM changes. */
export function blockLaidOut(block: BlockId): void {
  layoutListeners.get(block)?.forEach((listener) => listener());
}
