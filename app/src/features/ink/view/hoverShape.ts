// What the hover circle shows (design 5.7): the pen's tip at its width and color, or the eraser's size, only while a
// pen above the screen reports hover. A pen that is down, or has a button held, shows no circle: the tool takes over.
import { eraserHoverPreview, penHoverPreview } from '../pens/width';
import type { DrawTool } from './state';

/** The fields of a pointer event the circle reads. */
export interface HoverEvent {
  readonly pointerType: string;
  readonly buttons: number;
  readonly pressure: number;
}

export type HoverCircle =
  | { readonly kind: 'pen'; readonly diameter: number }
  | { readonly kind: 'eraser'; readonly diameter: number; readonly ring: boolean };

export interface HoverInput {
  readonly enabled: boolean;
  readonly tool: DrawTool;
  /** The active pen's width in page units. */
  readonly penWidth: number;
  /** The partial eraser's radius in page units. */
  readonly eraserRadius: number;
  /** The stroke eraser's reach in screen pixels. */
  readonly strokeEraserPx: number;
  readonly zoom: number;
}

/** True for a pen that is above the screen and pressing nothing. */
export function isHovering(event: HoverEvent): boolean {
  return event.pointerType === 'pen' && event.buttons === 0 && event.pressure === 0;
}

/** The circle for a hovering pen, or null when there is none to show. */
export function hoverCircle(event: HoverEvent, input: HoverInput): HoverCircle | null {
  if (!input.enabled || !isHovering(event)) return null;
  switch (input.tool) {
    case 'pen':
    case 'writing':
      return { kind: 'pen', diameter: penHoverPreview(input.penWidth, input.zoom).diameter };
    case 'eraser': {
      const preview = eraserHoverPreview(input.strokeEraserPx / input.zoom, input.zoom);
      return { kind: 'eraser', diameter: preview.diameter, ring: preview.ring };
    }
    case 'partialEraser': {
      const preview = eraserHoverPreview(input.eraserRadius, input.zoom);
      return { kind: 'eraser', diameter: preview.diameter, ring: preview.ring };
    }
    default:
      return null;
  }
}
