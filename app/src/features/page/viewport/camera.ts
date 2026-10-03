// The camera: the one description of where the page's world sits on screen (ARCHITECTURE.md section 5.4; owner
// after WP0: WP3). The page view owns it; Phase 5 reads it. client point = viewport origin + world point x zoom
// - scroll.
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
