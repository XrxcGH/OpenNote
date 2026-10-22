// Snapping and drawing helpers shared by the engineering diagrams. Model points are in grid units with y up; the
// screen flips y. A dragged part snaps to the nearest anchor of another part within reach (a body's corner, edge
// midpoint, or center; a joint; a terminal), and to the grid step otherwise, so parts click together.

export interface Point {
  x: number;
  y: number;
}

export const SNAP_REACH = 0.35;

export function snapToStep(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(6));
}

/** The nearest anchor within reach, or the point rounded to the step. */
export function snapPoint(p: Point, anchors: readonly Point[], step: number, reach = SNAP_REACH): Point {
  let best: Point | null = null;
  let bestDistance = reach;
  for (const anchor of anchors) {
    const distance = Math.hypot(anchor.x - p.x, anchor.y - p.y);
    if (distance <= bestDistance) {
      best = anchor;
      bestDistance = distance;
    }
  }
  return best ? { x: best.x, y: best.y } : { x: snapToStep(p.x, step), y: snapToStep(p.y, step) };
}

/** The nine anchors of a box: corners, edge midpoints, and center. */
export function boxAnchors(cx: number, cy: number, w: number, h: number): Point[] {
  const out: Point[] = [];
  for (const dx of [-w / 2, 0, w / 2]) for (const dy of [-h / 2, 0, h / 2]) out.push({ x: cx + dx, y: cy + dy });
  return out;
}

export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** An arrow from (x1, y1) to (x2, y2) in screen units: the shaft and a head drawn as one path. */
export function arrowPath(x1: number, y1: number, x2: number, y2: number, head = 9): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = 0.45;
  const hx1 = x2 - head * Math.cos(angle - spread);
  const hy1 = y2 - head * Math.sin(angle - spread);
  const hx2 = x2 - head * Math.cos(angle + spread);
  const hy2 = y2 - head * Math.sin(angle + spread);
  return `M${x1} ${y1}L${x2} ${y2}M${hx1} ${hy1}L${x2} ${y2}L${hx2} ${hy2}`;
}

/** A three-quarter arc with a head, for a moment: counterclockwise when `ccw`, in screen units. */
export function momentPath(cx: number, cy: number, r: number, ccw: boolean): string {
  // On screen y points down, so counterclockwise on paper runs from angle 0 toward -270 degrees.
  const sign = ccw ? -1 : 1;
  const start = (sign * -20 * Math.PI) / 180;
  const end = (sign * 250 * Math.PI) / 180;
  const sx = cx + r * Math.cos(start);
  const sy = cy + r * Math.sin(start);
  const ex = cx + r * Math.cos(end);
  const ey = cy + r * Math.sin(end);
  const sweep = ccw ? 0 : 1;
  const tangent = end + (sign * Math.PI) / 2;
  const head = 8;
  const h1x = ex - head * Math.cos(tangent - 0.5);
  const h1y = ey - head * Math.sin(tangent - 0.5);
  const h2x = ex - head * Math.cos(tangent + 0.5);
  const h2y = ey - head * Math.sin(tangent + 0.5);
  return `M${sx} ${sy}A${r} ${r} 0 1 ${sweep} ${ex} ${ey}M${h1x} ${h1y}L${ex} ${ey}L${h2x} ${h2y}`;
}
