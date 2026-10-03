// The page viewport (ARCHITECTURE.md sections 5 and 25.1; owner after WP0: WP3): the scroller, the sizer that makes
// the scroll bars match the zoomed world, the world in page units, and the underlay Phase 5 draws into. It keeps
// the camera: scroll and zoom listeners read no layout, a ResizeObserver keeps the viewport's rectangle, and camera
// listeners run at most once per frame during a gesture and once more when it settles.
import type { PageRect } from '../../../services/pages/types';
import { cameraToClient, cameraToWorld, clampZoom, ROOM_RIGHT, scrollForZoom, snapToDevice, worldSize } from './camera';
import type { Camera, GestureKind, Point } from './camera';
import styles from './viewport.module.css';

export interface PageViewportApi {
  /** .page-viewport, touch-action: none. */
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
  /** `focus` is the client point that stays still; the viewport's center when absent. */
  setZoom(zoom: number, focus?: Point): void;
  scrollIntoView(rect: PageRect, options?: { block?: 'nearest' | 'center' }): void;
  destroy(): void;
}

/** What the page view's own parts (the gestures, the block layer) use beyond the public API. */
export interface PageViewport extends PageViewportApi {
  readonly sizer: HTMLElement;
  /** Whether anything holds the camera. */
  held(): boolean;
  /**
   * The content's extent in page units; the world grows to fit it and never shrinks. Floating content gets room to
   * its right; a page of flowing text gets none, so it never scrolls sideways.
   */
  setContent(size: { w: number; h: number; floating?: boolean }): void;
  beginGesture(kind: GestureKind): void;
  endGesture(kind: GestureKind): void;
  /** Scrolls by CSS px. */
  panBy(dx: number, dy: number): void;
  /** Zooms keeping `focus` (a client point) still, as part of `kind`. */
  zoomAt(zoom: number, focus: Point, kind: GestureKind): void;
  scrollTo(x: number, y: number): void;
}

export { shownViewport, usePageViewport } from './shown';

/** A zoom gesture settles this long after its last input. */
export const SETTLE_MS = 150;
/** Ctrl+wheel and touchpad pinches zoom by e^(-deltaY x this). One mouse notch is about 22%. */
const WHEEL_ZOOM_RATE = 0.0025;

/** Calls `listener` when `element` resizes. Does nothing where ResizeObserver is missing (jsdom). */
export function observeResize(element: HTMLElement, listener: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  const observer = new ResizeObserver(listener);
  observer.observe(element);
  return () => observer.disconnect();
}

function layer(classNames: string, parent: HTMLElement): HTMLElement {
  const element = parent.ownerDocument.createElement('div');
  element.className = classNames;
  parent.append(element);
  return element;
}

/** The scroll offset that shows `start` to `start + length` (page units) on a `seen` px long side. */
function placeAlong(
  zoom: number,
  span: { start: number; length: number },
  scroll: number,
  seen: number,
  center: boolean,
) {
  const from = span.start * zoom;
  const to = (span.start + span.length) * zoom;
  if (center) return (from + to) / 2 - seen / 2;
  if (from < scroll) return from;
  if (to > scroll + seen) return Math.min(from, to - seen);
  return scroll;
}

class Viewport implements PageViewport {
  readonly viewport: HTMLElement;
  readonly sizer: HTMLElement;
  readonly world: HTMLElement;
  readonly underlay: HTMLElement;
  private readonly view: Window;
  private readonly cameraListeners = new Set<(camera: Camera) => void>();
  private readonly gestureListeners = new Set<(phase: 'start' | 'end', kind: GestureKind) => void>();
  private readonly gestures = new Set<GestureKind>();
  private readonly stopObserving: () => void;
  private rect: DOMRect;
  private zoom = 1;
  private scroll = { x: 0, y: 0 };
  private seq = 0;
  private content = { w: 0, h: 0 };
  private size: { w: number; h: number } | null = null;
  private holds = 0;
  private frame = 0;
  private resizeFrame = 0;
  private settleTimer = 0;
  private scrollTimer = 0;

  constructor(host: HTMLElement, classNames: { viewport: string; world: string; underlay: string }) {
    this.viewport = layer(`${styles.viewport} ${classNames.viewport}`, host);
    this.viewport.tabIndex = -1;
    this.viewport.dataset.scope = 'page';
    this.sizer = layer(styles.sizer, this.viewport);
    this.world = layer(`${styles.world} ${classNames.world}`, this.sizer);
    this.underlay = layer(`${styles.underlay} ${classNames.underlay}`, this.world);
    this.view = host.ownerDocument.defaultView ?? window;
    this.rect = this.viewport.getBoundingClientRect();
    this.stopObserving = observeResize(this.viewport, this.onResize);
    this.viewport.addEventListener('scroll', this.onScroll, { passive: true });
    this.viewport.addEventListener('scrollend', this.onScrollEnd, { passive: true });
    this.viewport.addEventListener('wheel', this.onWheel, { passive: false });
    this.applyZoom(1);
  }

  camera(): Camera {
    const { rect } = this;
    return {
      zoom: this.zoom,
      scrollX: this.scroll.x,
      scrollY: this.scroll.y,
      dpr: this.view.devicePixelRatio || 1,
      viewport: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      gesture: [...this.gestures].at(-1) ?? null,
      seq: this.seq,
    };
  }

  onCamera(listener: (camera: Camera) => void): () => void {
    this.cameraListeners.add(listener);
    return () => void this.cameraListeners.delete(listener);
  }

  onGesture(listener: (phase: 'start' | 'end', kind: GestureKind) => void): () => void {
    this.gestureListeners.add(listener);
    return () => void this.gestureListeners.delete(listener);
  }

  toWorld(clientX: number, clientY: number): Point {
    return cameraToWorld(this.camera(), clientX, clientY);
  }

  toClient(x: number, y: number): Point {
    return cameraToClient(this.camera(), x, y);
  }

  holdCamera(): () => void {
    this.holds += 1;
    let held = true;
    return () => {
      if (held) this.holds -= 1;
      held = false;
    };
  }

  held(): boolean {
    return this.holds > 0;
  }

  setZoom(zoom: number, focus?: Point): void {
    const { rect } = this;
    this.zoomAt(zoom, focus ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, 'commandZoom');
  }

  scrollIntoView(target: PageRect, options?: { block?: 'nearest' | 'center' }): void {
    const center = options?.block === 'center';
    const { zoom, rect, viewport } = this;
    const x = placeAlong(zoom, { start: target.x, length: target.w }, viewport.scrollLeft, rect.width, center);
    const y = placeAlong(zoom, { start: target.y, length: target.h }, viewport.scrollTop, rect.height, center);
    this.scrollTo(x, y);
  }

  setContent(next: { w: number; h: number; floating?: boolean }): void {
    const w = next.w + (next.floating === false ? 0 : ROOM_RIGHT);
    if (w <= this.content.w && next.h <= this.content.h) return;
    this.content = { w: Math.max(w, this.content.w), h: Math.max(next.h, this.content.h) };
    this.resize();
  }

  beginGesture(kind: GestureKind): void {
    if (this.gestures.has(kind)) return;
    this.gestures.add(kind);
    if (kind === 'pinch' || kind === 'wheelZoom') this.world.dataset.gesture = kind;
    this.gestureListeners.forEach((listener) => listener('start', kind));
    this.changed();
  }

  endGesture(kind: GestureKind): void {
    if (!this.gestures.delete(kind)) return;
    if (kind !== 'scroll') {
      const dpr = this.view.devicePixelRatio || 1;
      this.setScroll(snapToDevice(this.viewport.scrollLeft, dpr), snapToDevice(this.viewport.scrollTop, dpr));
    }
    if (![...this.gestures].some((other) => other === 'pinch' || other === 'wheelZoom')) {
      delete this.world.dataset.gesture;
    }
    this.gestureListeners.forEach((listener) => listener('end', kind));
    this.changed(this.gestures.size === 0);
  }

  panBy(dx: number, dy: number): void {
    this.setScroll(this.viewport.scrollLeft + dx, this.viewport.scrollTop + dy);
    this.changed();
  }

  zoomAt(next: number, focus: Point, kind: GestureKind): void {
    const zoom = clampZoom(next);
    const from = this.zoom;
    if (zoom === from) return;
    const x = scrollForZoom(this.viewport.scrollLeft, focus.x - this.rect.left, from, zoom);
    const y = scrollForZoom(this.viewport.scrollTop, focus.y - this.rect.top, from, zoom);
    this.applyZoom(zoom);
    this.setScroll(x, y);
    if (kind !== 'commandZoom') return this.changed();
    this.gestureListeners.forEach((listener) => listener('start', kind));
    this.gestureListeners.forEach((listener) => listener('end', kind));
    this.changed(this.gestures.size === 0);
  }

  scrollTo(x: number, y: number): void {
    this.setScroll(x, y);
    this.changed(this.gestures.size === 0);
  }

  destroy(): void {
    this.stopObserving();
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.view.clearTimeout(this.settleTimer);
    this.view.clearTimeout(this.scrollTimer);
    this.viewport.removeEventListener('scroll', this.onScroll);
    this.viewport.removeEventListener('scrollend', this.onScrollEnd);
    this.viewport.removeEventListener('wheel', this.onWheel);
    this.cameraListeners.clear();
    this.gestureListeners.clear();
    this.viewport.remove();
  }

  private changed(settled = false): void {
    this.seq += 1;
    if (settled) {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      return this.emit();
    }
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.emit();
    });
  }

  private emit(): void {
    const now = this.camera();
    this.cameraListeners.forEach((listener) => listener(now));
  }

  private resize(): void {
    const { rect, zoom } = this;
    // The viewport's inside, without its scroll bar gutter, so a page that fits never scrolls sideways.
    const inner = { w: this.viewport.clientWidth || rect.width, h: this.viewport.clientHeight || rect.height };
    const size = worldSize(this.content, inner, zoom, this.size);
    this.size = size;
    this.world.style.inlineSize = `${size.w}px`;
    this.world.style.blockSize = `${size.h}px`;
    this.sizer.style.inlineSize = `${size.w * zoom}px`;
    this.sizer.style.blockSize = `${size.h * zoom}px`;
  }

  private applyZoom(zoom: number): void {
    this.zoom = zoom;
    this.viewport.style.setProperty('--page-zoom', String(zoom));
    this.resize();
  }

  private setScroll(x: number, y: number): void {
    this.viewport.scrollLeft = Math.max(0, x);
    this.viewport.scrollTop = Math.max(0, y);
    this.scroll = { x: this.viewport.scrollLeft, y: this.viewport.scrollTop };
  }

  /** In the next frame: resizing the sizer from the observer would make the observer loop. */
  private readonly onResize = () => {
    if (this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = 0;
      this.rect = this.viewport.getBoundingClientRect();
      this.resize();
      this.changed(this.gestures.size === 0);
    });
  };

  private readonly onScroll = () => {
    this.scroll = { x: this.viewport.scrollLeft, y: this.viewport.scrollTop };
    if (this.gestures.size === 0) this.beginGesture('scroll');
    else this.changed();
    this.view.clearTimeout(this.scrollTimer);
    // scrollend ends it; the timer covers a WebView that never sends it.
    this.scrollTimer = this.view.setTimeout(() => this.endGesture('scroll'), SETTLE_MS * 2);
  };

  private readonly onScrollEnd = () => {
    this.view.clearTimeout(this.scrollTimer);
    this.endGesture('scroll');
  };

  private readonly onWheel = (event: WheelEvent) => {
    if (this.holds > 0) return void event.preventDefault();
    if (!event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.rect.height : 1;
    this.beginGesture('wheelZoom');
    const zoom = this.zoom * Math.exp(-event.deltaY * unit * WHEEL_ZOOM_RATE);
    this.zoomAt(zoom, { x: event.clientX, y: event.clientY }, 'wheelZoom');
    this.view.clearTimeout(this.settleTimer);
    this.settleTimer = this.view.setTimeout(() => this.endGesture('wheelZoom'), SETTLE_MS);
  };
}

export function createViewport(
  host: HTMLElement,
  classNames: { viewport: string; world: string; underlay: string },
): PageViewport {
  return new Viewport(host, classNames);
}
