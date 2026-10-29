// Text boxes and pictures while a draw tool is active (Beta 6, owner bug 5). The pen writes over a text box, so a quick
// tap stays a dot; a press held still for a moment, a finger tap, or a lasso tap on a floating block selects it
// instead, with no ink. The selection frame then moves it, resizes it, and deletes it, and a tap inside the selected
// box puts the caret there. The grip and width handle of a block the person selected or is editing stay the objects
// tool's in every tool, so the pen and the palm filter never take them.
import type { Vec } from '../geometry/types';
import type { InkHost } from './host';
import { blockItems } from './lasso';

/** A press held still at least this long (ms) on a text box selects it instead of leaving a dot. */
export const DWELL_MS = 300;
/** A tap moves less than this, in screen px. */
export const TAP_SLOP_PX = 4;

/** True for a press that stayed within the tap's slop and was held at least DWELL_MS. */
export function isDwellTap(downAt: number, upAt: number, travelPx: number): boolean {
  return travelPx <= TAP_SLOP_PX && upAt - downAt >= DWELL_MS;
}

/**
 * The floating block (a text box or a picture) at a point in page units, the topmost where they overlap. Null on the
 * flow's text, on ink, and on a locked block, which the pen writes over as it does over the page.
 */
export function objectAt(host: InkHost, at: Vec): string | null {
  const layer = host.layer.get();
  if (!layer) return null;
  let found: string | null = null;
  for (const item of blockItems(host)) {
    const box = item.frame;
    if (item.locked || at.x < box.minX || at.x > box.maxX || at.y < box.minY || at.y > box.maxY) continue;
    const frame = layer.block(item.id)?.frame;
    if (frame?.x !== undefined && frame.y !== undefined) found = item.id;
  }
  return found;
}

/** True while the caret is in this block: a tap there moves the caret rather than selecting the block. */
export function isEditing(host: InkHost, id: string): boolean {
  const element = host.layer.get()?.view(id)?.element;
  const active = element?.ownerDocument.activeElement;
  return !!element && !!active && element.contains(active);
}

/** Selects one block, so the selection frame shows around it. */
export function selectObject(host: InkHost, id: string): void {
  host.select({ blocks: [id], strokes: [] }, { announce: true });
}

/** True for a press on the grip or width handle of a block the person selected or is editing. */
export function onObjectHandle(host: InkHost, event: PointerEvent): boolean {
  const handle = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-handle]') : null;
  const block = handle?.dataset.block;
  if (!block) return false;
  return host.selection.get().blocks.includes(block) || isEditing(host, block);
}

/** Puts the caret in the typed text of one of `blocks` at a client point. False when none of them is there. */
export async function editTextAt(host: InkHost, x: number, y: number, blocks: readonly string[]): Promise<boolean> {
  const hit = await host.text?.hit(x, y);
  if (!hit || !blocks.includes(hit.block)) return false;
  host.select({ blocks: [], strokes: [] });
  return (await host.text?.select(hit.block, hit.pos, hit.pos)) ?? false;
}
