// The router's `select` tool (ARCHITECTURE.md section 5.6; owner WP3), at priority 10: everything no other tool
// claims. It never cancels an event, so the browser places the caret, selects text, and fires click and
// contextmenu. A press on static text mounts that block's editor in place, with the caret under the pointer, and a
// press on empty page that doesn't move places a caret there. Touch waits for the tap to end: a touch that moves
// is a pan. A touch or a pen held still opens the context menu (Chromium raises none for it unless Windows press and
// hold is on), and the tap that would follow is dropped.
import type { BlockId } from '../../../services/pages/types';
import type { Point } from '../viewport/camera';
import type { PointerToolDef } from '../viewport/router';
import { tokens } from '../../../theme/tokens';
import type { EditorPool } from './pool';
import { requestContextMenu } from '../viewport/menuRequests';

/** The text block whose static editing root the event's target is in, if any. */
function staticBlockOf(event: PointerEvent, pool: EditorPool): BlockId | null {
  const target = event.target instanceof Element ? event.target : null;
  const root = target?.closest<HTMLElement>('[data-scope="editor"][data-block]');
  const block = root?.dataset.block;
  return block && !pool.editor(block) ? block : null;
}

/** Whether the event's target is the page itself: the world, the flow, or the underlay, not a block or the title. */
function onEmptyPage(event: PointerEvent, world: HTMLElement): boolean {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !world.contains(target)) return false;
  return !target.closest('[data-block-id], [data-page-title], button, a, input');
}

export interface SelectToolOptions {
  readonly world: HTMLElement;
  /** A press on empty page that ended where it began, in page units. */
  pressEmpty(point: Point): void;
}

/** A press that moves less than this is a click or a tap. */
const TAP_SLOP = 4;
/** A held press that moves farther than this is a drag, not a long press. */
const HOLD_SLOP = 8;

export function createSelectTool(pool: EditorPool, options: SelectToolOptions): PointerToolDef {
  let empty: { x: number; y: number } | null = null;
  let hold: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  // Set once a long press has opened the menu: the lift that ends it is not a tap.
  let held = false;
  const endHold = () => {
    if (hold) clearTimeout(hold.timer);
    hold = null;
  };
  const beginHold = (event: PointerEvent) => {
    endHold();
    held = false;
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    const { pointerId: id, clientX: x, clientY: y, target } = event;
    const doc = options.world.ownerDocument;
    const timer = setTimeout(() => {
      hold = null;
      held = true;
      requestContextMenu(doc, x, y, target);
    }, tokens.interaction.longPressMs);
    hold = { id, x, y, timer };
  };
  const mountAt = (event: PointerEvent) => {
    const block = staticBlockOf(event, pool);
    if (block) pool.mount(block, { kind: 'point', event }, 'pointer');
  };
  return {
    id: 'select',
    priority: 10,
    accepts: (event, ctx) => ctx.activeTool === 'select' && event.button === 0,
    down(event) {
      empty = onEmptyPage(event, options.world) ? { x: event.clientX, y: event.clientY } : null;
      beginHold(event);
      if (event.pointerType !== 'touch') mountAt(event);
      return 'watch';
    },
    move(events) {
      const last = events.at(-1);
      if (
        hold &&
        last &&
        last.pointerId === hold.id &&
        Math.hypot(last.clientX - hold.x, last.clientY - hold.y) > HOLD_SLOP
      ) {
        endHold();
      }
      return 'watch';
    },
    up(event, ctx) {
      const start = empty;
      empty = null;
      endHold();
      if (held) {
        held = false;
        return;
      }
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < TAP_SLOP) {
        return options.pressEmpty(ctx.toWorld(event.clientX, event.clientY));
      }
      if (event.pointerType === 'touch') mountAt(event);
    },
    cancel() {
      empty = null;
      held = false;
      endHold();
    },
  };
}
