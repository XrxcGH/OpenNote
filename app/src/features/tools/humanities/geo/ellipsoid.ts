// The Earth as an ellipsoid: WGS84 and GRS80, the meridian arc, geodesics by Vincenty's formulas (1975, public
// domain), the spherical haversine distance, and rhumb lines. Angles in and out are degrees; lengths are meters.

export interface Ellipsoid {
  a: number;
  f: number;
}

export const WGS84: Ellipsoid = { a: 6378137, f: 1 / 298.257223563 };
export const GRS80: Ellipsoid = { a: 6378137, f: 1 / 298.257222101 };

/** The mean Earth radius R1 = (2a + b) / 3 of WGS84, in meters. */
export const MEAN_RADIUS = 6371008.8;

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

export class GeoError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export const e2Of = (ell: Ellipsoid) => ell.f * (2 - ell.f);

/** An angle in [0, 360). */
export const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;

/** An angle in [-180, 180). */
export const wrap180 = (deg: number) => wrap360(deg + 180) - 180;

/** The length of the meridian from the equator to this latitude, by Helmert's series in n to the fourth order. */
export function meridianArc(latDeg: number, ell: Ellipsoid = WGS84): number {
  const n = ell.f / (2 - ell.f);
  const phi = latDeg * RAD;
  const scale = (ell.a / (1 + n)) * (1 + (n * n) / 4 + n ** 4 / 64);
  return (
    scale *
    (phi -
      ((3 / 2) * n - (9 / 16) * n ** 3) * Math.sin(2 * phi) +
      ((15 / 16) * n * n - (15 / 32) * n ** 4) * Math.sin(4 * phi) -
      (35 / 48) * n ** 3 * Math.sin(6 * phi) +
      (315 / 512) * n ** 4 * Math.sin(8 * phi))
  );
}

/** The radius of curvature in the prime vertical at this latitude. */
export function primeVertical(latDeg: number, ell: Ellipsoid = WGS84): number {
  const s = Math.sin(latDeg * RAD);
  return ell.a / Math.sqrt(1 - e2Of(ell) * s * s);
}

export interface Inverse {
  /** Meters along the geodesic. */
  distance: number;
  /** The azimuth leaving the first point and arriving at the second, degrees clockwise from north. */
  azimuth1: number;
  azimuth2: number;
  iterations: number;
}

function checkLat(lat: number): void {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) throw new GeoError('latitude');
}

interface Loop {
  sinSigma: number;
  cosSigma: number;
  sigma: number;
  cos2Alpha: number;
  cos2SigmaM: number;
  sinLambda: number;
  cosLambda: number;
  iterations: number;
}

/** Vincenty's iteration on the longitude difference on the auxiliary sphere. Null for the same point. */
function vincentyLoop(L: number, f: number, sinU1: number, cosU1: number, sinU2: number, cosU2: number): Loop | null {
  let lambda = L;
  for (let iterations = 1; iterations <= 200; iterations += 1) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    const sinSigma = Math.hypot(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
    if (sinSigma === 0) return null;
    const cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    const sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    const cos2Alpha = 1 - sinAlpha * sinAlpha;
    const cos2SigmaM = cos2Alpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cos2Alpha;
    const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
    const next =
      L +
      (1 - C) *
        f *
        sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(next - lambda) < 1e-12) {
      return { sinSigma, cosSigma, sigma, cos2Alpha, cos2SigmaM, sinLambda, cosLambda, iterations };
    }
    if (Math.abs(next) > Math.PI) break;
    lambda = next;
  }
  throw new GeoError('antipodal');
}

/** The shortest path between two points on the ellipsoid. Nearly antipodal points may not converge. */
export function inverse(lat1: number, lon1: number, lat2: number, lon2: number, ell: Ellipsoid = WGS84): Inverse {
  checkLat(lat1);
  checkLat(lat2);
  const { a, f } = ell;
  const b = a * (1 - f);
  const U1 = Math.atan((1 - f) * Math.tan(lat1 * RAD));
  const U2 = Math.atan((1 - f) * Math.tan(lat2 * RAD));
  const [sinU1, cosU1, sinU2, cosU2] = [Math.sin(U1), Math.cos(U1), Math.sin(U2), Math.cos(U2)];
  const loop = vincentyLoop(wrap180(lon2 - lon1) * RAD, f, sinU1, cosU1, sinU2, cosU2);
  if (!loop) return { distance: 0, azimuth1: 0, azimuth2: 0, iterations: 0 };
  const { sinSigma, cosSigma, sigma, cos2Alpha, cos2SigmaM, sinLambda, cosLambda, iterations } = loop;
  const u2 = (cos2Alpha * (a * a - b * b)) / (b * b);
  const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  const distance = b * A * (sigma - deltaSigma);
  const azimuth1 = Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * DEG;
  const azimuth2 = Math.atan2(cosU1 * sinLambda, -sinU1 * cosU2 + cosU1 * sinU2 * cosLambda) * DEG;
  return { distance, azimuth1: wrap360(azimuth1), azimuth2: wrap360(azimuth2), iterations };
}

export interface Direct {
  lat: number;
  lon: number;
  /** The azimuth on arrival, degrees clockwise from north. */
  azimuth: number;
}

/** The point reached by going this many meters from a point on this azimuth along the geodesic. */
export function direct(lat1: number, lon1: number, azimuthDeg: number, distance: number, ell = WGS84): Direct {
  checkLat(lat1);
  if (!Number.isFinite(distance) || !Number.isFinite(azimuthDeg)) throw new GeoError('number');
  const { a, f } = ell;
  const b = a * (1 - f);
  const alpha1 = azimuthDeg * RAD;
  const [sinAlpha1, cosAlpha1] = [Math.sin(alpha1), Math.cos(alpha1)];
  const tanU1 = (1 - f) * Math.tan(lat1 * RAD);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;
  const sigma1 = Math.atan2(tanU1, cosAlpha1);
  const sinAlpha = cosU1 * sinAlpha1;
  const cos2Alpha = 1 - sinAlpha * sinAlpha;
  const u2 = (cos2Alpha * (a * a - b * b)) / (b * b);
  const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  let sigma = distance / (b * A);
  let cos2SigmaM = 0;
  for (let i = 0; i < 200; i += 1) {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
    const [sinSigma, cosSigma] = [Math.sin(sigma), Math.cos(sigma)];
    const deltaSigma =
      B *
      sinSigma *
      (cos2SigmaM +
        (B / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
            (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
    const next = distance / (b * A) + deltaSigma;
    if (Math.abs(next - sigma) < 1e-13) {
      sigma = next;
      break;
    }
    sigma = next;
  }
  const [sinSigma, cosSigma] = [Math.sin(sigma), Math.cos(sigma)];
  const x = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
  const lat = Math.atan2(sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1, (1 - f) * Math.hypot(sinAlpha, x));
  const lambda = Math.atan2(sinSigma * sinAlpha1, cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1);
  const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
  const L =
    lambda -
    (1 - C) * f * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  return { lat: lat * DEG, lon: wrap180(lon1 + L * DEG), azimuth: wrap360(Math.atan2(sinAlpha, -x) * DEG) };
}

/** The great-circle distance on a sphere of this radius. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number, radius = MEAN_RADIUS): number {
  checkLat(lat1);
  checkLat(lat2);
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The isometric latitude, which a rhumb line runs straight against with longitude. */
export function isometric(latDeg: number, ell: Ellipsoid = WGS84): number {
  const e = Math.sqrt(e2Of(ell));
  const s = Math.sin(latDeg * RAD);
  return Math.asinh(Math.tan(latDeg * RAD)) - e * Math.atanh(e * s);
}

/** A line of constant course between two points: its course and its length. */
export function rhumb(lat1: number, lon1: number, lat2: number, lon2: number, ell: Ellipsoid = WGS84) {
  checkLat(lat1);
  checkLat(lat2);
  if (Math.abs(lat1) === 90 || Math.abs(lat2) === 90) throw new GeoError('pole');
  const dLon = wrap180(lon2 - lon1) * RAD;
  const dPsi = isometric(lat2, ell) - isometric(lat1, ell);
  const course = Math.atan2(dLon, dPsi);
  const distance =
    Math.abs(lat2 - lat1) > 1e-12
      ? (meridianArc(lat2, ell) - meridianArc(lat1, ell)) / Math.cos(course)
      : Math.abs(dLon) * primeVertical(lat1, ell) * Math.cos(lat1 * RAD);
  return { course: wrap360(course * DEG), distance: Math.abs(distance) };
}

/** The point halfway along the geodesic between two points. */
export function midpoint(lat1: number, lon1: number, lat2: number, lon2: number, ell: Ellipsoid = WGS84): Direct {
  const path = inverse(lat1, lon1, lat2, lon2, ell);
  return direct(lat1, lon1, path.azimuth1, path.distance / 2, ell);
}
