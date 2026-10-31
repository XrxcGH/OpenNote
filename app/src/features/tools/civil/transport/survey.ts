// Trip generation and the surveying methods behind ./surveyCalcs: double meridian distance areas, trigonometric
// levelling, and the 2D Helmert (four-parameter) transformation. Lengths in meters, angles in degrees.
import { need } from '../core/types';

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Trips from rows of [land-use quantity, trip rate per unit], split in and out by the entering percentage. */
export function tripGeneration(rows: readonly (readonly number[])[], enteringPct: number) {
  need(rows.length >= 1, 'errors.noRows');
  need(enteringPct >= 0 && enteringPct <= 100, 'transport.errors.split');
  const trips = rows.map(([q, rate]) => {
    need(q! >= 0 && rate! >= 0, 'errors.nonNegative', { name: '~transport.f.qtyCol' });
    return q! * rate!;
  });
  const total = trips.reduce((a, b) => a + b, 0);
  return { trips, total, entering: (total * enteringPct) / 100, exiting: (total * (100 - enteringPct)) / 100 };
}

/**
 * Area by double meridian distances from balanced latitudes and departures: DMD₁ = dep₁,
 * DMDᵢ = DMDᵢ₋₁ + depᵢ₋₁ + depᵢ, and 2A = |Σ latᵢ DMDᵢ|.
 */
export function dmdArea(courses: readonly { lat: number; dep: number }[]) {
  need(courses.length >= 3, 'errors.fewPoints', { count: 3 });
  const dmd: number[] = [];
  let twice = 0;
  courses.forEach((c, i) => {
    const d = i === 0 ? c.dep : dmd[i - 1]! + courses[i - 1]!.dep + c.dep;
    dmd.push(d);
    twice += c.lat * d;
  });
  return { dmd, area: Math.abs(twice) / 2 };
}

/** Earth radius (m) and the usual refraction coefficient for the curvature-and-refraction correction. */
export const EARTH_R = 6_371_000;

/**
 * Trigonometric levelling from a slope distance and zenith angle: ΔH = S cos z + hᵢ − hₜ + (1 − k) H² / 2R,
 * with H = S sin z the horizontal distance. Pass k = null to leave out curvature and refraction.
 */
export function trigLevel(S: number, zenith: number, hi: number, ht: number, k: number | null) {
  need(S > 0, 'errors.positive', { name: '~transport.f.slopeDist' });
  need(zenith > 0 && zenith < 180, 'transport.errors.zenith');
  need(k === null || (k >= 0 && k < 1), 'transport.errors.refraction');
  const H = S * Math.sin(rad(zenith));
  const V = S * Math.cos(rad(zenith));
  const cr = k === null ? 0 : ((1 - k) * H * H) / (2 * EARTH_R);
  return { H, V, cr, dH: V + hi - ht + cr };
}

/**
 * Least-squares 2D Helmert fit, X = a x − b y + tx and Y = b x + a y + ty, from two or more control points given as
 * [x, y, X, Y]. Scale is √(a² + b²) and rotation atan2(b, a), counterclockwise positive.
 */
export function helmert(points: readonly (readonly number[])[]) {
  need(points.length >= 2, 'errors.fewPoints', { count: 2 });
  const n = points.length;
  const mean = (c: number) => points.reduce((s, p) => s + p[c]!, 0) / n;
  const [xm, ym, Xm, Ym] = [mean(0), mean(1), mean(2), mean(3)];
  let sxx = 0;
  let sa = 0;
  let sb = 0;
  for (const p of points) {
    const dx = p[0]! - xm;
    const dy = p[1]! - ym;
    const dX = p[2]! - Xm;
    const dY = p[3]! - Ym;
    sxx += dx * dx + dy * dy;
    sa += dx * dX + dy * dY;
    sb += dx * dY - dy * dX;
  }
  need(sxx > 1e-12, 'transport.errors.samePoints');
  const a = sa / sxx;
  const b = sb / sxx;
  const tx = Xm - a * xm + b * ym;
  const ty = Ym - b * xm - a * ym;
  const apply = (x: number, y: number): [number, number] => [a * x - b * y + tx, b * x + a * y + ty];
  const residuals = points.map((p) => {
    const [X, Y] = apply(p[0]!, p[1]!);
    return [p[2]! - X, p[3]! - Y] as [number, number];
  });
  const ss = residuals.reduce((s, [u, v]) => s + u * u + v * v, 0);
  // Four parameters from 2n observations; with two points the fit is exact and has no redundancy.
  const rms = n > 2 ? Math.sqrt(ss / (2 * n - 4)) : 0;
  return {
    a,
    b,
    tx,
    ty,
    scale: Math.hypot(a, b),
    rotation: (Math.atan2(b, a) * 180) / Math.PI,
    residuals,
    rms,
    apply,
  };
}
