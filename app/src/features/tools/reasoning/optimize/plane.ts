// The graphical method for a linear program in 2 variables: each constraint's line, the feasible region (clipped to
// a frame when it runs off to infinity), and the optimal corner.
import { el, label, pathD, round, svgRoot } from '../core/svg';
import type { SvgNode } from '../core/svg';

export interface Line2 {
  a: number;
  b: number;
  op: '<=' | '>=' | '=';
  c: number;
}

const EPS = 1e-9;
const holds = (l: Line2, x: number, y: number) => {
  const v = l.a * x + l.b * y - l.c;
  const tol = 1e-7 * (1 + Math.abs(l.c));
  return l.op === '<=' ? v <= tol : l.op === '>=' ? v >= -tol : Math.abs(v) <= tol;
};

/** The corners of the feasible region inside the frame [0, X] x [0, Y], in order around it. */
export function corners(cons: readonly Line2[], X: number, Y: number): [number, number][] {
  const all: Line2[] = [
    ...cons,
    { a: 1, b: 0, op: '>=', c: 0 },
    { a: 0, b: 1, op: '>=', c: 0 },
    { a: 1, b: 0, op: '<=', c: X },
    { a: 0, b: 1, op: '<=', c: Y },
  ];
  const pts: [number, number][] = [];
  for (let i = 0; i < all.length; i += 1)
    for (let j = i + 1; j < all.length; j += 1) {
      const p = all[i];
      const q = all[j];
      const det = p.a * q.b - p.b * q.a;
      if (Math.abs(det) < EPS) continue;
      const x = (p.c * q.b - p.b * q.c) / det;
      const y = (p.a * q.c - p.c * q.a) / det;
      if (all.every((l) => holds(l, x, y)) && !pts.some(([u, v]) => Math.abs(u - x) + Math.abs(v - y) < 1e-7))
        pts.push([x, y]);
    }
  if (pts.length < 3) return pts;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
}

/** A frame that holds every intersection of the constraint lines with each other and the axes, with a margin. */
export function frameFor(cons: readonly Line2[], best: [number, number] | null): [number, number] {
  let X = best ? best[0] : 0;
  let Y = best ? best[1] : 0;
  for (const l of cons) {
    if (Math.abs(l.a) > EPS && l.c / l.a > 0) X = Math.max(X, l.c / l.a);
    if (Math.abs(l.b) > EPS && l.c / l.b > 0) Y = Math.max(Y, l.c / l.b);
  }
  return [Math.max(1, X * 1.15), Math.max(1, Y * 1.15)];
}

export function planeFigure(
  cons: readonly Line2[],
  names: readonly [string, string],
  best: [number, number] | null,
): SvgNode {
  const [X, Y] = frameFor(cons, best);
  const W = 320;
  const H = 260;
  const left = 40;
  const top = 14;
  const sx = (x: number) => left + (x / X) * W;
  const sy = (y: number) => top + H - (y / Y) * H;
  const region = corners(cons, X, Y);
  const shapes: (SvgNode | null)[] = [];
  if (region.length >= 3)
    shapes.push(
      el('path', {
        d: pathD(...region.flatMap(([x, y], k) => [k ? 'L' : 'M', sx(x), sy(y)]), 'Z'),
        fill: '@accentSoft',
        stroke: 'none',
      }),
    );
  cons.forEach((l, k) => {
    // The line's ends where it crosses the frame.
    const ends: [number, number][] = [];
    if (Math.abs(l.b) > EPS)
      for (const x of [0, X]) {
        const y = (l.c - l.a * x) / l.b;
        if (y >= -EPS && y <= Y + EPS) ends.push([x, y]);
      }
    if (Math.abs(l.a) > EPS)
      for (const y of [0, Y]) {
        const x = (l.c - l.b * y) / l.a;
        if (x >= -EPS && x <= X + EPS) ends.push([x, y]);
      }
    if (ends.length < 2) return;
    const [p, q] = [ends[0], ends.find((e) => Math.abs(e[0] - ends[0][0]) + Math.abs(e[1] - ends[0][1]) > EPS)];
    if (!q) return;
    shapes.push(
      el('line', {
        x1: round(sx(p[0])),
        y1: round(sy(p[1])),
        x2: round(sx(q[0])),
        y2: round(sy(q[1])),
        stroke: '@muted',
      }),
    );
    const mid: [number, number] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    shapes.push(label(sx(mid[0]) + 10, sy(mid[1]) - 8, `(${k + 1})`, { fontSize: 11, fill: '@muted' }));
  });
  if (best) {
    shapes.push(el('circle', { cx: round(sx(best[0])), cy: round(sy(best[1])), r: 5, fill: '@hi', stroke: '@ink' }));
  }
  const axes = [
    el('line', { x1: left, y1: top + H, x2: left + W, y2: top + H, stroke: '@ink' }),
    el('line', { x1: left, y1: top, x2: left, y2: top + H, stroke: '@ink' }),
    label(left + W, top + H + 16, names[0], { textAnchor: 'end' }),
    label(left - 8, top + 4, names[1], { textAnchor: 'end' }),
    label(left, top + H + 16, '0', { fontSize: 11, fill: '@muted' }),
  ];
  return svgRoot(left + W + 20, top + H + 30, ...shapes, ...axes);
}
