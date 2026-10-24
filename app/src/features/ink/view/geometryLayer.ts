// What the measure and the compass share: an SVG layer in the page's chrome that they draw on in screen pixels, and
// the rule for which contacts they take. Both take the pen and the mouse. A finger is taken only when no pen has
// touched for a moment and no other finger is down, so the heel of a writing hand never marks or draws.
import type { Vec } from '../geometry/types';
import type { InkCamera } from './host';
import type { InkSurface } from './surface';

const SVG = 'http://www.w3.org/2000/svg';
/** A finger is taken this long after the pen last touched, in milliseconds. */
const PEN_QUIET_MS = 800;

export function svgNode<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Readonly<Record<string, string | number>> = {},
): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** A full-size SVG layer over the page, under the snap widgets, that never takes the pointer. */
export function geometryLayer(surface: InkSurface, which: string): SVGSVGElement {
  const svg = svgNode(surface.chrome.ownerDocument, 'svg', { 'aria-hidden': 'true' });
  svg.dataset.inkGeometry = which;
  Object.assign(svg.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    overflow: 'visible',
    pointerEvents: 'none',
    color: 'var(--color-accent-primary)',
  });
  surface.chrome.append(svg);
  return svg;
}

/** A page point in the layer's screen pixels. */
export function toScreen(camera: InkCamera, p: Vec): Vec {
  return { x: p.x * camera.zoom - camera.scrollX, y: p.y * camera.zoom - camera.scrollY };
}

/** Decides, per pointer down, whether the measure, or the compass, takes a contact. */
export function createContactRule(): { takes(event: PointerEvent): boolean; release(event: PointerEvent): void } {
  let penAt = -Infinity;
  const fingers = new Set<number>();
  return {
    takes(event) {
      if (event.pointerType === 'pen') {
        penAt = event.timeStamp;
        return true;
      }
      if (event.pointerType === 'mouse') return event.button === 0;
      if (event.pointerType !== 'touch') return false;
      if (event.timeStamp - penAt < PEN_QUIET_MS || fingers.size > 0) return false;
      fingers.add(event.pointerId);
      return true;
    },
    release(event) {
      fingers.delete(event.pointerId);
      if (event.pointerType === 'pen') penAt = event.timeStamp;
    },
  };
}
