// Level-of-detail rules: how much of a page to draw at a zoom. Zoomed far out, ruled lines would blur into gray and
// thousands of dots would cost time for nothing, so the view draws fewer of them, or none.

/** Lines closer together than this many CSS pixels on screen are thinned out. */
export const MIN_LINE_GAP = 6;
/** Thinning keeps every nth line. Beyond this n, the pattern is hidden. */
export const MAX_THINNING = 8;

export type Detail = 'full' | 'simplified' | 'thumbnail';

/**
 * How much to draw. At 50% and above everything shows. Between 25% and 50% the view skips paper patterns and tiles of
 * fine ink detail. Below 25% a sheet is a thumbnail: its paper color, its outline, and a raster of its content.
 */
export function detailLevel(zoom: number): Detail {
  if (zoom >= 0.5) return 'full';
  return zoom >= 0.25 ? 'simplified' : 'thumbnail';
}

/**
 * Which lines of a pattern to draw: every nth line, so the lines stay at least `MIN_LINE_GAP` pixels apart. Returns 0
 * when the pattern would need more thinning than `MAX_THINNING`, which means it is hidden.
 */
export function lineEvery(spacing: number, zoom: number): number {
  const gap = spacing * zoom;
  if (!(gap > 0)) return 0;
  const n = Math.ceil(MIN_LINE_GAP / gap);
  return n > MAX_THINNING ? 0 : Math.max(1, n);
}

/** True when ruled lines, grids, and dots draw at this zoom. */
export function showsPaper(spacing: number, zoom: number): boolean {
  return detailLevel(zoom) !== 'thumbnail' && lineEvery(spacing, zoom) > 0;
}

/**
 * The scale at which to rasterize a cached tile of ink or paper, as a power of two at or above the zoom times the
 * screen's pixel ratio. Tiles keep their raster while the zoom stays within one step of it, so a pinch re-renders only
 * when it crosses a step.
 */
export function tileScale(zoom: number, pixelRatio: number): number {
  const wanted = Math.max(0.0625, zoom * Math.max(1, pixelRatio));
  return 2 ** Math.ceil(Math.log2(wanted) - 1e-9);
}
