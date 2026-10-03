// Which renderer draws a block (owner WP3): the highest-priority registered or built-in renderer for its type whose
// flag is on, and the placeholder for types nothing renders. Phase 5 registers its ink renderer above the slot.
import { blockRenderers } from '../registries';
import { inkSlotRenderer } from './inkSlot';
import { textBlockRenderer } from './textBlock';
import type { BlockRenderContext, BlockRendererDef } from './types';
import { unknownBlockRenderer } from './unknownBlock';

const BUILT_IN: readonly BlockRendererDef[] = [textBlockRenderer, inkSlotRenderer];

export function rendererFor(type: string, ctx: BlockRenderContext): BlockRendererDef {
  const candidates = [...blockRenderers.list(), ...BUILT_IN].filter(
    (def) => def.types.includes(type) && (!def.flag || ctx.host.flag(def.flag)),
  );
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0] ?? unknownBlockRenderer;
}
