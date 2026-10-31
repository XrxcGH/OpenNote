// Tabulated x-y equilibrium for McCabe-Thiele: a curve read linearly between typed points, and the minimum reflux
// found graphically, where the rectifying line first touches the curve.
import { need } from '../core/types';
import type { Equilibrium } from './engine';

/** Rows of [x, y] for the light component; (0, 0) and (1, 1) are added when missing. */
export function tableEquilibrium(rows: readonly (readonly number[])[]): Equilibrium & { points: [number, number][] } {
  const pts = rows.map(([x, y]) => [x!, y!] as [number, number]);
  if (!pts.length || pts[0]![0] > 0) pts.unshift([0, 0]);
  if (pts[pts.length - 1]![0] < 1) pts.push([1, 1]);
  need(pts.length >= 3, 'errors.fewPoints', { count: 1 });
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i]!;
    need(x >= 0 && x <= 1 && y >= 0 && y <= 1, 'process.errors.eqTable');
    if (i) need(x > pts[i - 1]![0] && y > pts[i - 1]![1], 'process.errors.eqTable');
  }
  const read = (v: number, from: 0 | 1): number => {
    const to = from === 0 ? 1 : 0;
    const k = Math.max(
      1,
      pts.findIndex((p) => p[from] >= v),
    );
    const a = pts[k - 1]!;
    const b = pts[k]!;
    return a[to] + ((v - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
  };
  return { y: (x) => read(x, 0), x: (y) => read(y, 1), points: pts };
}

/**
 * Minimum reflux on any curve: the rectifying line from (xD, xD) must stay on or below the curve between the q-line
 * crossing and xD, so its slope R/(R + 1) is the largest (xD − y)/(xD − x) over that range. This catches a tangent
 * pinch as well as a pinch at the feed.
 */
export function minReflux(
  eq: Equilibrium & { points?: [number, number][] },
  xD: number,
  zF: number,
  q: number,
): number {
  need(zF > 0 && zF < xD && xD < 1, 'process.errors.purities');
  // The q-line meets the curve where (q − 1) y(x) − q x + zF = 0, which is positive at x = 0 and negative at x = 1.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if ((q - 1) * eq.y(mid) - q * mid + zF > 0) lo = mid;
    else hi = mid;
  }
  const xq = (lo + hi) / 2;
  need(xq < xD, 'process.errors.purities');
  // On a table the ratio is monotonic along each straight piece, so the knots and the crossing are enough.
  const knots = eq.points?.map((p) => p[0]) ?? [];
  const xs = [xq, ...knots.filter((x) => x > xq && x < xD)];
  if (!knots.length) for (let i = 1; i < 2000; i++) xs.push(xq + ((xD - xq) * i) / 2000);
  let slope = -Infinity;
  for (const x of xs) slope = Math.max(slope, (xD - eq.y(x)) / (xD - x));
  need(slope < 1, 'process.errors.azeotrope');
  return slope / (1 - slope);
}
