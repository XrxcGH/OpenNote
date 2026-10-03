// The camera: the one description of where the page's world sits on screen (ARCHITECTURE.md section 5.4; owner
// after WP0: WP3). The page view owns it; Phase 5 reads it. client point = viewport origin + world point x zoom
// - scroll. The math here is pure, so the viewport, the gestures, and the tests share it.
import type { PageRect } from '../../../services/pages/types';

export type GestureKind = 'scroll' | 'touchPan' | 'pinch' | 'wheelZoom' | 'commandZoom';

export interface Point {
  x: number;
  y: number;
}

export interface Camera {
  /** 0.25 to 4. */
  readonly zoom: number;
  /** CSS px, the viewport's scroll offset. */
  readonly scrollX: number;
  readonly scrollY: number;
  readonly dpr: number;
  /** The viewport's client rectangle, CSS px. */
  readonly viewport: PageRect;
  /** Null when settled. */
  readonly gesture: GestureKind | null;
  /** Grows on every change. */
  readonly seq: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/** The zooms the commands step through (ARCHITECTURE.md section 5.3). Gestures zoom anywhere between the ends. */
export const ZOOM_STEPS: readonly number[] = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
];

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** The next step above or below `zoom`, which may sit between steps after a pinch. Stops at the ends. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const near = (step: number) => Math.abs(step - zoom) < 0.005;
  if (direction > 0) return ZOOM_STEPS.find((step) => step > zoom && !near(step)) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom && !near(step)) ?? MIN_ZOOM;
}

/** A zoom as a whole percent, for announcements. */
export function zoomPercent(zoom: number): number {
  return Math.round(zoom * 100);
}

/**
 * The scroll offset that keeps the point `focus` (CSS px from the viewport's edge) still while the zoom goes from
 * `from` to `to`: scroll' = (scroll + p) x z1 / z0 - p.
 */
export function scrollForZoom(scroll: number, focus: number, from: number, to: number): number {
  return ((scroll + focus) * to) / from - focus;
}

/** Rounds a scroll offset to whole device pixels, so settled tiles land on them (ARCHITECTURE.md section 5.2). */
export function snapToDevice(offset: number, dpr: number): number {
  const ratio = dpr > 0 ? dpr : 1;
  return Math.round(offset * ratio) / ratio;
}

/** Client coordinates to page units. */
export function cameraToWorld(camera: Camera, clientX: number, clientY: number): Point {
  return {
    x: (clientX - camera.viewport.x + camera.scrollX) / camera.zoom,
    y: (clientY - camera.viewport.y + camera.scrollY) / camera.zoom,
  };
}

/** Page units to client coordinates. */
export function cameraToClient(camera: Camera, x: number, y: number): Point {
  return {
    x: camera.viewport.x + x * camera.zoom - camera.scrollX,
    y: camera.viewport.y + y * camera.zoom - camera.scrollY,
  };
}

/** A rectangle in page units as a client rectangle. */
export function rectToClient(camera: Camera, rect: PageRect): PageRect {
  const origin = cameraToClient(camera, rect.x, rect.y);
  return { x: origin.x, y: origin.y, w: rect.w * camera.zoom, h: rect.h * camera.zoom };
}

/** Room to the right of freeform content, in page units, for the next text box or drawing. */
export const ROOM_RIGHT = 480;

/**
 * The world's size while a page is open (ARCHITECTURE.md section 5.1): the content (with its room to the right)
 * plus half a viewport below, at least the viewport, and never smaller than before, so content never jumps.
 */
export function worldSize(
  content: { w: number; h: number },
  viewport: { w: number; h: number },
  zoom: number,
  previous: { w: number; h: number } | null,
): { w: number; h: number } {
  const seenW = viewport.w / zoom;
  const seenH = viewport.h / zoom;
  const w = Math.ceil(Math.max(content.w, seenW, previous?.w ?? 0));
  const h = Math.ceil(Math.max(content.h + seenH / 2, seenH, previous?.h ?? 0));
  return { w, h };
}

/** The zoom that fits content `right` units wide (with its margin) into a viewport `width` px wide. */
export function fitWidthZoom(right: number, width: number): number {
  if (right <= 0 || width <= 0) return 1;
  return clampZoom(Math.floor((width / right) * 100) / 100);
}
