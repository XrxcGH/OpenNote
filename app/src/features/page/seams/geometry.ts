// Text geometry for Phase 5's anchors and spelling (ARCHITECTURE.md section 25.5; owner after WP0: WP3). WP0's
// version reads only plain text from the shown page's blocks; boxes and ranges arrive with WP3.
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

let source: ((block: BlockId) => HTMLElement | null) | null = null;
const layoutListeners = new Map<BlockId, Set<() => void>>();

/** The shown page's block elements; the page view sets it while a page is shown. */
export function setGeometrySource(next: ((block: BlockId) => HTMLElement | null) | null): void {
  source = next;
}

export const textGeometry: TextGeometry = {
  lineBoxes: () => [],
  rectForOffset: () => null,
  rangeAt: () => null,
  plainText: (block) => source?.(block)?.textContent ?? '',
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
