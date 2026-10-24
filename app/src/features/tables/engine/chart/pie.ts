// Pie geometry. Plot has no pie mark, so the render layer draws these slices with d3-shape or plain SVG arcs.
// Slices start at 12 o'clock and run clockwise in table order. The legend carries names and percentages.

import type { Point } from './data';
import type { PieSlice, SeriesStyle } from './types';

const FULL_TURN = Math.PI * 2;

/** Slices for positive values. `styles[i]` styles slice `i`. */
export function pieSlices(points: readonly Point[], styles: readonly SeriesStyle[]): PieSlice[] {
  const total = points.reduce((sum, p) => sum + p.y, 0);
  let angle = 0;
  return points.map((p, i) => {
    const share = total > 0 ? p.y / total : 0;
    const slice: PieSlice = {
      label: String(p.x),
      value: p.y,
      share,
      startAngle: angle,
      endAngle: angle + share * FULL_TURN,
      style: styles[i],
    };
    angle = slice.endAngle;
    return slice;
  });
}
