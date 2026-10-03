// The block layer (ARCHITECTURE.md section 7; owner after WP0: WP3): one wrapper per block in page order, made by
// the renderer registered for its type. WP0's layer appends wrappers in order; WP3 renders the viewport first.
import type { BlockId, BlockJson, PageJson } from '../../../services/pages/types';
import { blockRenderers } from '../registries';
import { textBlockRenderer } from './textBlock';
import type { BlockLayer, BlockRenderContext, BlockRendererDef, BlockView } from './types';
import { unknownBlockRenderer } from './unknownBlock';

const BUILT_IN: readonly BlockRendererDef[] = [textBlockRenderer];

function rendererFor(type: string, ctx: BlockRenderContext): BlockRendererDef {
  const candidates = [...blockRenderers.list(), ...BUILT_IN].filter(
    (def) => def.types.includes(type) && (!def.flag || ctx.host.flag(def.flag)),
  );
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0] ?? unknownBlockRenderer;
}

export function createBlockLayer(world: HTMLElement, ctx: BlockRenderContext): BlockLayer & { destroy(): void } {
  const views = new Map<BlockId, { view: BlockView; block: BlockJson }>();
  const ordered = () => [...views.values()].sort((a, b) => (a.block.order < b.block.order ? -1 : 1));
  const place = (entry: { view: BlockView; block: BlockJson }) => {
    const next = ordered().find((other) => other.block.order > entry.block.order && other !== entry);
    world.insertBefore(entry.view.element, next?.view.element ?? null);
  };
  const create = (block: BlockJson) => {
    const entry = { view: rendererFor(block.type, ctx).create(block, ctx), block };
    views.set(block.id, entry);
    place(entry);
  };
  const remove = (id: BlockId) => {
    views.get(id)?.view.destroy();
    views.delete(id);
  };
  return {
    apply(page: PageJson) {
      [...views.keys()].forEach(remove);
      page.blocks.forEach(create);
    },
    upsert(block) {
      const entry = views.get(block.id);
      if (!entry || entry.block.type !== block.type) {
        if (entry) remove(block.id);
        create(block);
        return;
      }
      const moved = entry.block.order !== block.order;
      entry.block = block;
      entry.view.update(block);
      if (moved) place(entry);
    },
    remove,
    setOrder(order) {
      const focused = world.ownerDocument.activeElement;
      for (const id of order) {
        const element = views.get(id)?.view.element;
        if (element && !element.contains(focused)) world.append(element);
      }
    },
    view: (id) => views.get(id)?.view ?? null,
    insertionPoint() {
      const ink = ordered().find(({ block }) => block.type === 'ink');
      return ink ? { before: ink.block.id } : {};
    },
    destroy() {
      [...views.keys()].forEach(remove);
    },
  };
}
