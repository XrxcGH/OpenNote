// A local site grid tied to UTM or any other map grid by a 2D Helmert (similarity) transformation. It is fitted to
// control points by least squares. The model is E = a·x − b·y + c and N = b·x + a·y + d: one scale, one rotation,
// and one shift.
import { DEG, GeoError } from '../geo/ellipsoid';

export interface Control {
  x: number;
  y: number;
  e: number;
  n: number;
}

export interface Helmert {
  a: number;
  b: number;
  c: number;
  d: number;
  scale: number;
  /** Rotation from the site grid to the map grid, degrees counterclockwise. */
  rotation: number;
  /** For each control point, the map position the fit gives minus the one given, in map units. */
  residuals: { de: number; dn: number }[];
  rms: number;
}

export function fitHelmert(points: readonly Control[]): Helmert {
  if (points.length < 2) throw new GeoError('fewPoints');
  if (points.some((p) => ![p.x, p.y, p.e, p.n].every(Number.isFinite))) throw new GeoError('number');
  const count = points.length;
  const mean = (pick: (p: Control) => number) => points.reduce((sum, p) => sum + pick(p), 0) / count;
  const [mx, my, me, mn] = [mean((p) => p.x), mean((p) => p.y), mean((p) => p.e), mean((p) => p.n)];
  let sxx = 0;
  let sa = 0;
  let sb = 0;
  for (const p of points) {
    const [x, y, e, n] = [p.x - mx, p.y - my, p.e - me, p.n - mn];
    sxx += x * x + y * y;
    sa += x * e + y * n;
    sb += x * n - y * e;
  }
  if (sxx < 1e-18) throw new GeoError('samePoints');
  const a = sa / sxx;
  const b = sb / sxx;
  const c = me - a * mx + b * my;
  const d = mn - b * mx - a * my;
  const residuals = points.map((p) => ({ de: a * p.x - b * p.y + c - p.e, dn: b * p.x + a * p.y + d - p.n }));
  const rms = Math.sqrt(residuals.reduce((sum, r) => sum + r.de * r.de + r.dn * r.dn, 0) / count);
  return { a, b, c, d, scale: Math.hypot(a, b), rotation: Math.atan2(b, a) * DEG, residuals, rms };
}

export const siteToMap = (h: Helmert, x: number, y: number) => ({
  e: h.a * x - h.b * y + h.c,
  n: h.b * x + h.a * y + h.d,
});

export function mapToSite(h: Helmert, e: number, n: number) {
  const k = h.a * h.a + h.b * h.b;
  const [de, dn] = [e - h.c, n - h.d];
  return { x: (h.a * de + h.b * dn) / k, y: (h.a * dn - h.b * de) / k };
}
