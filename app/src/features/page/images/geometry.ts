// The portable math of image blocks (Phase 4 ARCHITECTURE.md sections 12.3 and 12.4): the initial size, the crop
// display, resizing by a handle, and cropping by a handle. Plain layout does the crop, not `object-view-box`, so
// every WebView and Phase 6's print path show the same thing.

/** The part of the image shown, in fractions of the image (SPEC 6.3). */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The smallest side a frame or a crop keeps, in page units and in fractions. */
export const MIN_SIDE = 16;
export const MIN_CROP = 0.02;
/** Freeform images start no wider than this (section 12.3). */
export const FREEFORM_MAX_WIDTH = 640;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const round = (value: number) => Math.round(value * 100) / 100;

/** A block's crop, or null for the whole image or a crop that isn't one. */
export function cropOf(data: Record<string, unknown>): Crop | null {
  const crop = data.crop as Partial<Record<keyof Crop, unknown>> | undefined;
  if (!crop || typeof crop !== 'object') return null;
  const { x, y, w, h } = crop;
  if (![x, y, w, h].every((part) => typeof part === 'number' && Number.isFinite(part))) return null;
  const valid = { x: x as number, y: y as number, w: w as number, h: h as number };
  if (valid.w <= 0 || valid.h <= 0 || valid.x < 0 || valid.y < 0) return null;
  if (valid.x + valid.w > 1.0001 || valid.y + valid.h > 1.0001) return null;
  return isWhole(valid) ? null : valid;
}

export function isWhole(crop: Crop): boolean {
  return crop.x <= 0.0001 && crop.y <= 0.0001 && crop.w >= 0.9999 && crop.h >= 0.9999;
}

/** The first size of an imported image: its pixels at the screen's density, no wider than `maxWidth`. */
export function initialSize(
  pixels: { width: number; height: number },
  options: { dpr: number; maxWidth: number },
): Size {
  const dpr = options.dpr > 0 ? options.dpr : 1;
  let w = Math.max(1, pixels.width / dpr);
  let h = Math.max(1, pixels.height / dpr);
  if (w > options.maxWidth) {
    h = (h * options.maxWidth) / w;
    w = options.maxWidth;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

/** The frame's height for a width, keeping the shown part's aspect ratio. */
export function heightFor(width: number, pixels: { width: number; height: number }, crop: Crop | null): number {
  const whole = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const shownW = pixels.width * whole.w;
  const shownH = pixels.height * whole.h;
  return shownW > 0 ? round((width * shownH) / shownW) : width;
}

/** Where the image element sits inside its clipping frame: the whole image, offset so the crop fills the frame. */
export function cropLayout(frame: Size, crop: Crop | null): Rect {
  if (!crop) return { x: 0, y: 0, w: frame.w, h: frame.h };
  const w = frame.w / crop.w;
  const h = frame.h / crop.h;
  return { x: round(-crop.x * w), y: round(-crop.y * h), w: round(w), h: round(h) };
}

/**
 * A frame resized by dragging a handle by (dx, dy). Corners keep the aspect ratio unless `free` (Shift); side
 * handles change one dimension. The opposite edge or corner stays put.
 */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, free = false): Rect {
  const west = handle.includes('w');
  const north = handle.startsWith('n');
  const horizontal = handle.includes('e') || west;
  const vertical = handle.startsWith('n') || handle.startsWith('s');
  let w = horizontal ? start.w + (west ? -dx : dx) : start.w;
  let h = vertical ? start.h + (north ? -dy : dy) : start.h;
  if (horizontal && vertical && !free) {
    const ratio = start.w / start.h;
    // The larger relative change leads, as in Office.
    if (Math.abs(w / start.w - 1) >= Math.abs(h / start.h - 1)) h = w / ratio;
    else w = h * ratio;
    if (w < MIN_SIDE || h < MIN_SIDE) {
      const scale = Math.max(MIN_SIDE / w, MIN_SIDE / h);
      w *= scale;
      h *= scale;
    }
  }
  w = Math.max(MIN_SIDE, w);
  h = Math.max(MIN_SIDE, h);
  return {
    x: round(west ? start.x + start.w - w : start.x),
    y: round(north ? start.y + start.h - h : start.y),
    w: round(w),
    h: round(h),
  };
}

/** A crop changed by dragging a crop handle by (dx, dy), as fractions of the whole image. */
export function cropDrag(start: Crop | null, handle: Handle, dx: number, dy: number): Crop {
  const crop = start ?? { x: 0, y: 0, w: 1, h: 1 };
  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.w;
  let bottom = crop.y + crop.h;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - MIN_CROP);
  if (handle.includes('e')) right = clamp(right + dx, left + MIN_CROP, 1);
  if (handle.startsWith('n')) top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (handle.startsWith('s')) bottom = clamp(bottom + dy, top + MIN_CROP, 1);
  return { x: round4(left), y: round4(top), w: round4(right - left), h: round4(bottom - top) };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** A crop as the "Size and position" fields show it: how much is cut from each side, in percent. */
export interface CropInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function cropToInsets(crop: Crop | null): CropInsets {
  const whole = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const percent = (fraction: number) => Math.round(fraction * 1000) / 10;
  return {
    left: percent(whole.x),
    top: percent(whole.y),
    right: percent(1 - whole.x - whole.w),
    bottom: percent(1 - whole.y - whole.h),
  };
}

/** The crop that the fields name, or null for the whole image. Sides that would cross are held apart. */
export function insetsToCrop(insets: CropInsets): Crop | null {
  const part = (value: number) => clamp(Number.isFinite(value) ? value / 100 : 0, 0, 1);
  const left = part(insets.left);
  const top = part(insets.top);
  const right = Math.min(part(insets.right), 1 - left - MIN_CROP);
  const bottom = Math.min(part(insets.bottom), 1 - top - MIN_CROP);
  const crop = { x: round4(left), y: round4(top), w: round4(1 - left - right), h: round4(1 - top - bottom) };
  return isWhole(crop) ? null : crop;
}

/**
 * The frame after a crop changes, so the image keeps its scale: the whole image's shown size stays the same, and
 * the frame moves by what was cut from the left and the top.
 */
export function frameForCrop(frame: Rect, before: Crop | null, after: Crop | null): Rect {
  const from = before ?? { x: 0, y: 0, w: 1, h: 1 };
  const to = after ?? { x: 0, y: 0, w: 1, h: 1 };
  const wholeW = frame.w / from.w;
  const wholeH = frame.h / from.h;
  return {
    x: round(frame.x + (to.x - from.x) * wholeW),
    y: round(frame.y + (to.y - from.y) * wholeH),
    w: round(Math.max(MIN_SIDE, to.w * wholeW)),
    h: round(Math.max(MIN_SIDE, to.h * wholeH)),
  };
}
