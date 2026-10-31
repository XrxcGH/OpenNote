// Transverse Mercator on the ellipsoid by Krüger's series in the third flattening n, to the sixth order (Karney,
// "Transverse Mercator with an accuracy of a few nanometers", J. Geodesy 85, 2011). Accurate to well under a
// millimeter within 3,900 km of the central meridian. Angles are degrees; lengths are meters.
import { DEG, GeoError, RAD, WGS84, e2Of, wrap180 } from './ellipsoid';
import type { Ellipsoid } from './ellipsoid';

interface Series {
  A: number;
  alpha: number[];
  beta: number[];
  e: number;
}

const cache = new Map<Ellipsoid, Series>();

function series(ell: Ellipsoid): Series {
  const found = cache.get(ell);
  if (found) return found;
  const n = ell.f / (2 - ell.f);
  const [n2, n3, n4, n5, n6] = [n ** 2, n ** 3, n ** 4, n ** 5, n ** 6];
  const A = (ell.a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  const alpha = [
    n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5 + (7891 / 37800) * n6,
    (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5 - (1983433 / 1935360) * n6,
    (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5 + (167603 / 181440) * n6,
    (49561 / 161280) * n4 - (179 / 168) * n5 + (6601661 / 7257600) * n6,
    (34729 / 80640) * n5 - (3418889 / 1995840) * n6,
    (212378941 / 319334400) * n6,
  ];
  const beta = [
    n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4 - (81 / 512) * n5 + (96199 / 604800) * n6,
    (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4 + (46 / 105) * n5 - (1118711 / 3870720) * n6,
    (17 / 480) * n3 - (37 / 840) * n4 - (209 / 4480) * n5 + (5569 / 90720) * n6,
    (4397 / 161280) * n4 - (11 / 504) * n5 - (830251 / 7257600) * n6,
    (4583 / 161280) * n5 - (108847 / 3991680) * n6,
    (20648693 / 638668800) * n6,
  ];
  const made = { A, alpha, beta, e: Math.sqrt(e2Of(ell)) };
  cache.set(ell, made);
  return made;
}

/** tan of the conformal latitude from tan of the latitude. */
function taupOf(tau: number, e: number): number {
  const sigma = Math.sinh(e * Math.atanh((e * tau) / Math.sqrt(1 + tau * tau)));
  return tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
}

/** tan of the latitude from tan of the conformal latitude, by Newton's method. */
function tauOf(taup: number, e: number): number {
  const e2 = e * e;
  let tau = taup;
  for (let i = 0; i < 10; i += 1) {
    const taupi = taupOf(tau, e);
    const step =
      ((taup - taupi) / Math.sqrt(1 + taupi * taupi)) *
      ((1 + (1 - e2) * tau * tau) / ((1 - e2) * Math.sqrt(1 + tau * tau)));
    tau += step;
    if (Math.abs(step) < 1e-15 * Math.max(1, Math.abs(tau))) break;
  }
  return tau;
}

export interface TmPoint {
  /** Meters east of the central meridian and north of the equator, on the unscaled projection times k0. */
  x: number;
  y: number;
  /** Grid convergence: the angle from true north to grid north, degrees, positive east. */
  convergence: number;
  /** The point scale factor. */
  scale: number;
}

/** Projects a point with the central meridian lon0 and the central scale k0, from the equator. */
export function tmForward(lat: number, lon: number, lon0: number, k0: number, ell: Ellipsoid = WGS84): TmPoint {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) throw new GeoError('latitude');
  const dLon = wrap180(lon - lon0);
  if (Math.abs(dLon) > 60) throw new GeoError('farFromMeridian');
  const { A, alpha, e } = series(ell);
  const lambda = dLon * RAD;
  // The poles are taken a hair inside, where every formula below stays finite.
  const phi = Math.max(-90 + 1e-10, Math.min(90 - 1e-10, lat)) * RAD;
  const taup = taupOf(Math.tan(phi), e);
  const xip = Math.atan2(taup, Math.cos(lambda));
  const etap = Math.asinh(Math.sin(lambda) / Math.hypot(taup, Math.cos(lambda)));
  let xi = xip;
  let eta = etap;
  let p = 1;
  let q = 0;
  alpha.forEach((coefficient, index) => {
    const j2 = 2 * (index + 1);
    xi += coefficient * Math.sin(j2 * xip) * Math.cosh(j2 * etap);
    eta += coefficient * Math.cos(j2 * xip) * Math.sinh(j2 * etap);
    p += j2 * coefficient * Math.cos(j2 * xip) * Math.cosh(j2 * etap);
    q += j2 * coefficient * Math.sin(j2 * xip) * Math.sinh(j2 * etap);
  });
  const gamma = Math.atan(Math.tan(xip) * Math.tanh(etap)) + Math.atan2(q, p);
  const tau = Math.tan(phi);
  const scale =
    k0 *
    (A / ell.a) *
    Math.hypot(p, q) *
    ((Math.sqrt(1 - e * e * Math.sin(phi) ** 2) * Math.sqrt(1 + tau * tau)) / Math.hypot(taup, Math.cos(lambda)));
  return { x: k0 * A * eta, y: k0 * A * xi, convergence: gamma * DEG, scale };
}

/** Undoes tmForward: the latitude and longitude of a point x meters east and y meters north. */
export function tmInverse(x: number, y: number, lon0: number, k0: number, ell: Ellipsoid = WGS84) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new GeoError('number');
  const { A, beta, e } = series(ell);
  const xi = y / (k0 * A);
  const eta = x / (k0 * A);
  if (Math.abs(xi) > Math.PI / 2 + 1e-9 || Math.abs(eta) > 3) throw new GeoError('farFromMeridian');
  let xip = xi;
  let etap = eta;
  beta.forEach((coefficient, index) => {
    const j2 = 2 * (index + 1);
    xip -= coefficient * Math.sin(j2 * xi) * Math.cosh(j2 * eta);
    etap -= coefficient * Math.cos(j2 * xi) * Math.sinh(j2 * eta);
  });
  const taup = Math.sin(xip) / Math.hypot(Math.sinh(etap), Math.cos(xip));
  const lambda = Math.atan2(Math.sinh(etap), Math.cos(xip));
  const lat = Math.atan(tauOf(taup, e)) * DEG;
  return { lat, lon: wrap180(lon0 + lambda * DEG) };
}
