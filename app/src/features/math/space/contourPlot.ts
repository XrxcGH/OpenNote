// The contour plot: the first surface's level curves seen from above, on the grapher's own grid and axes, with each
// level's value written beside its longest piece. It draws through the same Paint and Drawn marks as the 3D view.
import { computeGrid } from '../grapher/ticks';
import type { Size, Viewport } from '../grapher/types';
import { toPixel } from '../grapher/viewport';
import type { Drawn, Paint } from './project';
import type { World } from './world';

const fmt = (value: number) => String(Number(value.toFixed(2)));

export function contourMarks(world: World, size: Size, paint: Paint): Drawn[] {
  const view: Viewport = {
    xMin: world.box.min[0],
    xMax: world.box.max[0],
    yMin: world.box.min[1],
    yMax: world.box.max[1],
  };
  const grid = computeGrid(view, size);
  const out: Drawn[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, width: number): Drawn => ({
    tag: 'line',
    attrs: { x1: fmt(x1), y1: fmt(y1), x2: fmt(x2), y2: fmt(y2), stroke, strokeWidth: width, strokeLinecap: 'round' },
  });
  for (const tick of grid.x)
    if (tick.major) out.push(line(tick.position, 0, tick.position, size.height, paint.stroke('box', 0), 0.6));
  for (const tick of grid.y)
    if (tick.major) out.push(line(0, tick.position, size.width, tick.position, paint.stroke('box', 0), 0.6));
  out.push(line(0, grid.xAxis.pixel, size.width, grid.xAxis.pixel, paint.stroke('axis', 0), 1.25));
  out.push(line(grid.yAxis.pixel, 0, grid.yAxis.pixel, size.height, paint.stroke('axis', 0), 1.25));
  const zSpan = world.box.max[2] - world.box.min[2] || 1;
  const text = (x: number, y: number, value: string, anchor: string): Drawn => ({
    tag: 'text',
    attrs: { x: fmt(x), y: fmt(y), textAnchor: anchor, fill: paint.text, fontSize: 11, fontFamily: paint.fontFamily },
    text: value,
  });
  for (const tick of grid.x) {
    if (tick.major && tick.label !== '0')
      out.push(text(tick.position, Math.min(size.height - 4, grid.xAxis.pixel + 13), tick.label, 'middle'));
  }
  for (const tick of grid.y) {
    if (tick.major && tick.label !== '0') out.push(text(grid.yAxis.pixel + 4, tick.position - 3, tick.label, 'start'));
  }
  for (const curve of world.contours) {
    const tone = (curve.level - world.box.min[2]) / zSpan;
    const stroke = paint.stroke('contour', 0, tone);
    let longest: { x: number; y: number; length: number } | null = null;
    for (const [x1, y1, x2, y2] of curve.segments) {
      const a = toPixel(view, size, { x: x1, y: y1 });
      const b = toPixel(view, size, { x: x2, y: y2 });
      out.push(line(a.x, a.y, b.x, b.y, stroke, 1.75));
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      // The label goes on a piece near the middle of the plot, where it is least likely to be cut off.
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const inside = mid.x > 24 && mid.x < size.width - 24 && mid.y > 14 && mid.y < size.height - 8;
      if (inside && (!longest || length > longest.length)) longest = { ...mid, length };
    }
    if (longest) out.push(text(longest.x, longest.y - 3, String(Number(curve.level.toPrecision(3))), 'middle'));
  }
  if (world.tangent) {
    const at = toPixel(view, size, { x: world.tangent.x, y: world.tangent.y });
    out.push({
      tag: 'circle',
      attrs: {
        cx: fmt(at.x),
        cy: fmt(at.y),
        r: 4.5,
        fill: paint.dot('tangent', -1),
        stroke: paint.paper,
        strokeWidth: 1.5,
      },
    });
  }
  return out;
}
