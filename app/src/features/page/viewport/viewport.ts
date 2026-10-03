// The page viewport (ARCHITECTURE.md sections 5 and 25.1; owner after WP0: WP3). WP0's viewport is static: native
// scrolling, zoom 1, and no gestures. It builds the three layers Phase 5 draws into and keeps the camera current.
import type { PageRect } from '../../../services/pages/types';
import { createStore, useStore } from '../../../state/store';
import type { Camera, GestureKind, Point } from './camera';

export interface PageViewportApi {
  /** .page-viewport, touch-action: none once WP3's gestures land. */
  readonly viewport: HTMLElement;
  /** .page-world, scaled by the zoom. */
  readonly world: HTMLElement;
  /** .page-underlay, below every block. */
  readonly underlay: HTMLElement;
  camera(): Camera;
  /** Once per frame during gestures, once when settled. */
  onCamera(listener: (camera: Camera) => void): () => void;
  onGesture(listener: (phase: 'start' | 'end', kind: GestureKind) => void): () => void;
  /** Page units. */
  toWorld(clientX: number, clientY: number): Point;
  toClient(x: number, y: number): Point;
  /** Pan and zoom input are ignored until the returned function runs. */
  holdCamera(reason: 'pen' | 'drag' | (string & {})): () => void;
  setZoom(zoom: number, focus?: Point): void;
  scrollIntoView(rect: PageRect, options?: { block?: 'nearest' | 'center' }): void;
  destroy(): void;
}

/** The viewport of the page that is shown, for usePageViewport. */
export const shownViewport = createStore<PageViewportApi | null>(null, 'page viewport');

export function usePageViewport(): PageViewportApi | null {
  return useStore(shownViewport, (viewport) => viewport);
}

function layer(className: string, parent: HTMLElement): HTMLElement {
  const element = parent.ownerDocument.createElement('div');
  element.className = className;
  parent.append(element);
  return element;
}

export function createViewport(
  host: HTMLElement,
  classNames: { viewport: string; world: string; underlay: string },
): PageViewportApi {
  const viewport = layer(classNames.viewport, host);
  const world = layer(classNames.world, viewport);
  const underlay = layer(classNames.underlay, world);
  const listeners = new Set<(camera: Camera) => void>();
  let seq = 0;
  let zoom = 1;
  const camera = (): Camera => {
    const rect = viewport.getBoundingClientRect();
    return {
      zoom,
      scrollX: viewport.scrollLeft,
      scrollY: viewport.scrollTop,
      dpr: window.devicePixelRatio || 1,
      viewport: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      gesture: null,
      seq,
    };
  };
  const changed = () => {
    seq++;
    const now = camera();
    listeners.forEach((listener) => listener(now));
  };
  viewport.addEventListener('scroll', changed, { passive: true });
  return {
    viewport,
    world,
    underlay,
    camera,
    onCamera(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    onGesture: () => () => undefined,
    toWorld(clientX, clientY) {
      const { viewport: rect, scrollX, scrollY } = camera();
      return { x: (clientX - rect.x + scrollX) / zoom, y: (clientY - rect.y + scrollY) / zoom };
    },
    toClient(x, y) {
      const { viewport: rect, scrollX, scrollY } = camera();
      return { x: rect.x + x * zoom - scrollX, y: rect.y + y * zoom - scrollY };
    },
    holdCamera: () => () => undefined,
    setZoom(next) {
      zoom = Math.min(4, Math.max(0.25, next));
      world.style.setProperty('--page-zoom', String(zoom));
      changed();
    },
    scrollIntoView(rect, options) {
      const target = world.ownerDocument.createElement('div');
      Object.assign(target.style, {
        position: 'absolute',
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.w}px`,
        height: `${rect.h}px`,
      });
      world.append(target);
      target.scrollIntoView({ block: options?.block ?? 'nearest' });
      target.remove();
    },
    destroy() {
      viewport.removeEventListener('scroll', changed);
      listeners.clear();
      viewport.remove();
    },
  };
}
