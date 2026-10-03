// The block layer (ARCHITECTURE.md sections 5.1, 7.1, and 20.1; owner after WP0: WP3). It creates, orders, and
// removes block wrappers itself, so a keystroke never re-renders React and React never moves a focused wrapper.
// - DOM order is reading order; floating blocks sit at their frames, and z-index carries the drawing order.
// - The viewport's blocks render before the first paint, and the rest in idle slices of at most 8 ms.
// - A new order moves the fewest wrappers, and never the one that holds focus or the editor in use.
import type { BlockId, BlockJson, PageJson } from '../../../services/pages/types';
import type { PagePool } from '../pool/pool';
import { byOrder, readingOrder } from '../readingOrder/order';
import { nameBlocks } from '../readingOrder/names';
import { pinnedReorder } from '../readingOrder/pinned';
import { rendererFor } from './renderers';
import { isFloating, isLazy } from './textBlock';
import type { LazyBlockView } from './textBlock';
import type { BlockLayer, BlockRenderContext, BlockView } from './types';

/** Idle rendering yields after this long. */
const SLICE_MS = 8;
/** Blocks this far outside the viewport (page units) render with it. */
const NEAR_UNITS = 200;

interface Entry {
  view: BlockView;
  block: BlockJson;
}

/** The page view's block layer: the contract, plus what the page's own parts read. */
export interface PageBlockLayer extends BlockLayer {
  /** The blocks in reading order. */
  blocks(): readonly BlockJson[];
  block(id: BlockId): BlockJson | null;
  /** view.readingOrder, which comes first in the reading order. */
  setPreferredOrder(order: readonly BlockId[]): void;
  /** After blocks are added, removed, changed, or reordered. */
  onChange(listener: () => void): () => void;
  /** Rendered blocks' heights in page units, to remember on this device. */
  heights(): Record<BlockId, number>;
  destroy(): void;
}

type IdleWindow = Window & { requestIdleCallback?: (callback: () => void) => number };

class Layer implements PageBlockLayer {
  private readonly entries = new Map<BlockId, Entry>();
  private readonly listeners = new Set<() => void>();
  private preferred: readonly BlockId[] = [];
  private order: BlockId[] = [];
  private idle = 0;
  private destroyed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly ctx: BlockRenderContext,
  ) {}

  apply(page: PageJson): void {
    [...this.entries.keys()].forEach((id) => this.drop(id));
    this.preferred = page.view.readingOrder ?? [];
    for (const block of page.blocks) {
      this.entries.set(block.id, { view: rendererFor(block.type, this.ctx).create(block, this.ctx), block });
    }
    this.order = readingOrder(page.blocks, this.preferred);
    this.container.append(...this.order.map((id) => this.entries.get(id)!.view.element));
    this.stack();
    this.renderNear();
    this.scheduleRest();
    this.changed();
  }

  upsert(block: BlockJson): void {
    const entry = this.entries.get(block.id);
    if (entry && entry.block.type === block.type) {
      entry.block = block;
      entry.view.update(block);
    } else {
      if (entry) this.drop(block.id);
      const view = rendererFor(block.type, this.ctx).create(block, this.ctx);
      this.entries.set(block.id, { view, block });
      if (isLazy(view)) view.render();
    }
    this.refresh();
  }

  remove(id: BlockId): void {
    if (!this.entries.has(id)) return;
    this.drop(id);
    this.refresh();
  }

  setOrder(order: readonly BlockId[]): void {
    const elements = order.flatMap((id) => this.entries.get(id)?.view.element ?? []);
    pinnedReorder(this.container, elements, this.pinned());
    this.order = order.filter((id) => this.entries.has(id));
  }

  view(id: BlockId): BlockView | null {
    return this.entries.get(id)?.view ?? null;
  }

  insertionPoint(): { before?: BlockId; after?: BlockId } {
    const byKey = [...this.entries.values()].map(({ block }) => block).sort(byOrder);
    const ink = byKey.find((block) => block.type === 'ink');
    if (ink) return { before: ink.id };
    const last = byKey.filter(isFloating).at(-1);
    return last ? { after: last.id } : {};
  }

  blocks(): readonly BlockJson[] {
    return this.order.flatMap((id) => this.entries.get(id)?.block ?? []);
  }

  block(id: BlockId): BlockJson | null {
    return this.entries.get(id)?.block ?? null;
  }

  setPreferredOrder(order: readonly BlockId[]): void {
    this.preferred = order;
    this.refresh();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  heights(): Record<BlockId, number> {
    const out: Record<BlockId, number> = {};
    for (const [id, { view }] of this.entries) {
      if (isLazy(view) && view.rendered) out[id] = Math.round(view.element.offsetHeight);
    }
    return out;
  }

  destroy(): void {
    this.destroyed = true;
    [...this.entries.keys()].forEach((id) => this.drop(id));
    this.listeners.clear();
  }

  private drop(id: BlockId): void {
    this.entries.get(id)?.view.destroy();
    this.entries.delete(id);
  }

  /** The wrapper that holds focus, or the active editor's: a reorder never moves it. */
  private pinned(): Element | null {
    const focused = this.container.ownerDocument.activeElement;
    for (const { view } of this.entries.values()) if (view.element.contains(focused)) return view.element;
    const active = (this.ctx.pool as PagePool).active?.();
    return (active && this.entries.get(active.block)?.view.element) || null;
  }

  private refresh(): void {
    const blocks = [...this.entries.values()].map(({ block }) => block);
    this.setOrder(readingOrder(blocks, this.preferred));
    this.stack();
    this.changed();
  }

  /** Floating blocks draw in order key order, above flowing ones. */
  private stack(): void {
    const floating = [...this.entries.values()].filter(({ block }) => isFloating(block));
    floating.sort((a, b) => byOrder(a.block, b.block));
    floating.forEach(({ view }, rank) => (view.element.style.zIndex = String(rank + 1)));
    for (const { block, view } of this.entries.values()) if (!isFloating(block)) view.element.style.zIndex = '';
    nameBlocks(this.blocks(), (id) => this.view(id));
  }

  private unrendered(): LazyBlockView[] {
    return this.order.flatMap((id) => {
      const view = this.entries.get(id)?.view;
      return view && isLazy(view) && !view.rendered ? [view] : [];
    });
  }

  /** Renders the blocks that meet the viewport; all of them when it has no size yet. */
  private renderNear(): void {
    const camera = this.ctx.viewport.camera();
    const waiting = this.unrendered();
    if (camera.viewport.h <= 0) return waiting.forEach((view) => view.render());
    const top = camera.scrollY / camera.zoom - NEAR_UNITS;
    const bottom = (camera.scrollY + camera.viewport.h) / camera.zoom + NEAR_UNITS;
    for (const view of waiting) {
      const rect = view.measure();
      if (rect.y < bottom && rect.y + rect.h > top) view.render();
    }
  }

  private scheduleRest(): void {
    if (this.idle || this.destroyed) return;
    const view = this.container.ownerDocument.defaultView as IdleWindow | null;
    if (!view) return;
    const run = () => {
      this.idle = 0;
      if (this.destroyed) return;
      const started = performance.now();
      for (const lazy of this.unrendered()) {
        if (performance.now() - started >= SLICE_MS) return this.scheduleRest();
        lazy.render();
      }
    };
    this.idle = view.requestIdleCallback ? view.requestIdleCallback(run) : view.setTimeout(run, 0);
  }

  private changed(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export function createBlockLayer(container: HTMLElement, ctx: BlockRenderContext): PageBlockLayer {
  return new Layer(container, ctx);
}
