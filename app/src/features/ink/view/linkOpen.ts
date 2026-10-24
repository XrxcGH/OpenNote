// Opening a link on handwriting by pressing it (Beta 5 walk W2-7): with Select and type, a click, a pen tap, or a
// finger tap on writing that is a link opens the link, as a link in typed text does. A press that moves is no tap and
// opens nothing. Drawing tools keep the pen for ink, so writing over a link never opens it.
import { isEnabled } from '../../../app/flags';
import type { Store } from '../../../state/store';
import type { InkHost, InkPointerTool, InkRouterContext } from './host';
import { inkLinks, liveLinks } from './inkLinks';
import type { InkLink } from './inkLinks';
import { openInkLink } from './linkDialogs';
import { drawState } from './state';
import type { InkSurface } from './surface';

/** How near a stroke's box the press may land, in screen pixels. */
const REACH_PX = 4;
/** How far a press may move and still be a tap, in screen pixels. */
const TAP_SLOP_PX = 6;

/** The link under a point, in page units: the one whose strokes' boxes the point is on. */
export function linkAt(surface: InkSurface, point: { x: number; y: number }, reach: number): InkLink | null {
  const links = inkLinks.get();
  if (links.size === 0) return null;
  const near = new Set(
    surface
      .query({ minX: point.x - reach, minY: point.y - reach, maxX: point.x + reach, maxY: point.y + reach })
      .map((stroke) => stroke.id),
  );
  if (near.size === 0) return null;
  const live = liveLinks(links, (id) => surface.strokes([id]).length > 0);
  return live.find(([, link]) => link.strokes.some((id) => near.has(id)))?.[1] ?? null;
}

export function installLinkOpening(host: InkHost, surfaces: Store<InkSurface | null>): () => void {
  let press: { pointerId: number; x: number; y: number; link: InkLink } | null = null;
  const find = (event: PointerEvent, ctx: InkRouterContext): InkLink | null => {
    const surface = surfaces.get();
    if (!surface || !isEnabled('ink.links') || drawState.get().tool !== 'select') return null;
    const zoom = surface.cameraNow().zoom;
    return linkAt(surface, ctx.toWorld(event.clientX, event.clientY), REACH_PX / zoom);
  };
  const tool: InkPointerTool = {
    id: 'ink.linkOpen',
    // Above the palm filter (100), so a finger can tap a link too.
    priority: 107,
    accepts: (event, ctx) => event.isPrimary && event.button === 0 && find(event, ctx) !== null,
    down(event, ctx) {
      const link = find(event, ctx);
      if (!link || press) return 'watch';
      ctx.capture(event.pointerId);
      press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, link };
      return 'claim';
    },
    move(events) {
      const event = events.at(-1);
      if (press && event && Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_SLOP_PX) press = null;
      return 'claim';
    },
    up(event) {
      const tapped = press && press.pointerId === event.pointerId ? press.link : null;
      press = null;
      if (tapped) void openInkLink(host, tapped);
    },
    cancel() {
      press = null;
    },
  };
  return host.registerPointerTool(tool);
}
