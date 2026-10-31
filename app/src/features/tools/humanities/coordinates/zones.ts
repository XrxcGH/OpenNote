// Grid zones defined by their published parameters, as US State Plane (SPCS 83) zones are: Lambert conformal conic
// with two standard parallels (Snyder, USGS Professional Paper 1395, public domain) and transverse Mercator with a
// latitude of origin. The parameters are typed from the zone's published sheet; meters or US survey feet.
import { DEG, GeoError, GRS80, RAD, e2Of, wrap180 } from '../geo/ellipsoid';
import type { Ellipsoid } from '../geo/ellipsoid';
import { tmForward, tmInverse } from '../geo/tm';

export const US_SURVEY_FOOT = 1200 / 3937;
export const INTERNATIONAL_FOOT = 0.3048;

export interface LambertZone {
  kind: 'lambert';
  /** Standard parallels, degrees. */
  lat1: number;
  lat2: number;
  /** Latitude and longitude of the grid origin, degrees. */
  lat0: number;
  lon0: number;
  /** False easting and northing in meters. */
  falseEasting: number;
  falseNorthing: number;
}

export interface TmZone {
  kind: 'tm';
  /** Scale on the central meridian, such as 0.9999. */
  k0: number;
  lat0: number;
  lon0: number;
  falseEasting: number;
  falseNorthing: number;
}

export type Zone = LambertZone | TmZone;

const m = (phi: number, e2: number) => Math.cos(phi) / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);

function t(phi: number, e: number): number {
  const s = e * Math.sin(phi);
  return Math.tan(Math.PI / 4 - phi / 2) / ((1 - s) / (1 + s)) ** (e / 2);
}

function lambertConstants(zone: LambertZone, ell: Ellipsoid) {
  const e2 = e2Of(ell);
  const e = Math.sqrt(e2);
  const [p1, p2, p0] = [zone.lat1 * RAD, zone.lat2 * RAD, zone.lat0 * RAD];
  if ([zone.lat1, zone.lat2, zone.lat0].some((lat) => !Number.isFinite(lat) || Math.abs(lat) >= 90)) {
    throw new GeoError('latitude');
  }
  if (Math.abs(zone.lat1 + zone.lat2) < 1e-9) throw new GeoError('parallels');
  const [m1, m2, t1, t2] = [m(p1, e2), m(p2, e2), t(p1, e), t(p2, e)];
  const n = Math.abs(p1 - p2) < 1e-12 ? Math.sin(p1) : (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const F = m1 / (n * t1 ** n);
  const rho0 = ell.a * F * t(p0, e) ** n;
  return { e, e2, n, F, rho0 };
}

export interface GridPoint {
  easting: number;
  northing: number;
  /** The angle from true north to grid north, degrees, positive east. */
  convergence: number;
  scale: number;
}

export function zoneForward(zone: Zone, lat: number, lon: number, ell: Ellipsoid = GRS80): GridPoint {
  if (!Number.isFinite(lat) || Math.abs(lat) >= 90) throw new GeoError('latitude');
  if (zone.kind === 'tm') {
    const origin = tmForward(zone.lat0, zone.lon0, zone.lon0, zone.k0, ell);
    const point = tmForward(lat, lon, zone.lon0, zone.k0, ell);
    return {
      easting: zone.falseEasting + point.x,
      northing: zone.falseNorthing + point.y - origin.y,
      convergence: point.convergence,
      scale: point.scale,
    };
  }
  const { e, e2, n, F, rho0 } = lambertConstants(zone, ell);
  const phi = lat * RAD;
  const rho = ell.a * F * t(phi, e) ** n;
  const theta = n * wrap180(lon - zone.lon0) * RAD;
  return {
    easting: zone.falseEasting + rho * Math.sin(theta),
    northing: zone.falseNorthing + rho0 - rho * Math.cos(theta),
    convergence: theta * DEG,
    scale: (rho * n) / (ell.a * m(phi, e2)),
  };
}

export function zoneInverse(zone: Zone, easting: number, northing: number, ell: Ellipsoid = GRS80) {
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) throw new GeoError('number');
  if (zone.kind === 'tm') {
    const origin = tmForward(zone.lat0, zone.lon0, zone.lon0, zone.k0, ell);
    return tmInverse(easting - zone.falseEasting, northing - zone.falseNorthing + origin.y, zone.lon0, zone.k0, ell);
  }
  const { e, n, F, rho0 } = lambertConstants(zone, ell);
  const x = easting - zone.falseEasting;
  const y = rho0 - (northing - zone.falseNorthing);
  const sign = Math.sign(n);
  const rho = sign * Math.hypot(x, y);
  const theta = Math.atan2(sign * x, sign * y);
  const tp = (rho / (ell.a * F)) ** (1 / n);
  let phi = Math.PI / 2 - 2 * Math.atan(tp);
  for (let i = 0; i < 20; i += 1) {
    const s = e * Math.sin(phi);
    const next = Math.PI / 2 - 2 * Math.atan(tp * ((1 - s) / (1 + s)) ** (e / 2));
    if (Math.abs(next - phi) < 1e-14) {
      phi = next;
      break;
    }
    phi = next;
  }
  return { lat: phi * DEG, lon: wrap180(theta / n / RAD + zone.lon0) };
}
