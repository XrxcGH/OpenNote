// The router's `select` tool (ARCHITECTURE.md section 5.6; owner WP3), at priority 10: everything no other tool
// claims. It never cancels an event, so the browser places the caret, selects text, and fires click and
// contextmenu. Its one job is the pointer-down mount: a press on static text mounts that block's editor in place,
// with the caret under the pointer. Touch waits for the tap to end, since a touch that moves is a pan.
import type { BlockId } from '../../../services/pages/types';
import type { PointerToolDef } from '../viewport/router';
import type { EditorPool } from './pool';

/** The text block whose static editing root the event's target is in, if any. */
function staticBlockOf(event: PointerEvent, pool: EditorPool): BlockId | null {
  const target = event.target instanceof Element ? event.target : null;
  const root = target?.closest<HTMLElement>('[data-scope="editor"][data-block]');
  const block = root?.dataset.block;
  return block && !pool.editor(block) ? block : null;
}

export function createSelectTool(pool: EditorPool): PointerToolDef {
  const mountAt = (event: PointerEvent) => {
    const block = staticBlockOf(event, pool);
    if (block) pool.mount(block, { kind: 'point', event }, 'pointer');
  };
  return {
    id: 'select',
    priority: 10,
    accepts: (event, ctx) => ctx.activeTool === 'select' && event.button === 0,
    down(event) {
      if (event.pointerType !== 'touch') mountAt(event);
      return 'watch';
    },
    up(event) {
      if (event.pointerType === 'touch') mountAt(event);
    },
  };
}
