// Land and marine navigation on a local plane and, for dead reckoning, on the sphere: azimuth conversions with
// declination and grid convergence, back azimuths, pace counts, intersection, and resection, dead reckoning, the
// current triangle, time, speed and distance, and chart scale. Azimuths are degrees clockwise from north.
import { GeoError, RAD, DEG, wrap360 } from '../geo/ellipsoid';

/** Magnetic azimuth from true: declination is positive when magnetic north lies east of true north. */
export const trueToMagnetic = (az: number, declinationEast: number) => wrap360(az - declinationEast);
export const magneticToTrue = (az: number, declinationEast: number) => wrap360(az + declinationEast);

/** Grid azimuth from true: convergence is positive when grid north lies east of true north. */
export const trueToGrid = (az: number, convergenceEast: number) => wrap360(az - convergenceEast);
export const gridToTrue = (az: number, convergenceEast: number) => wrap360(az + convergenceEast);

/** The grid-magnetic angle: how far magnetic north lies east of grid north. */
export const gridMagneticAngle = (declinationEast: number, convergenceEast: number) =>
  declinationEast - convergenceEast;

export const backAzimuth = (az: number) => wrap360(az + 180);

/** Meters walked for a pace count, from the paces a person takes for 100 m. */
export function paceDistance(paces: number, pacesPer100m: number): number {
  if (!(pacesPer100m > 0) || !(paces >= 0)) throw new GeoError('positive');
  return (paces * 100) / pacesPer100m;
}

export interface Point {
  x: number;
  y: number;
}

/** Where two bearing lines from two known points cross, with how far along each line it is. */
export function intersect(p1: Point, az1: number, p2: Point, az2: number) {
  const [d1x, d1y] = [Math.sin(az1 * RAD), Math.cos(az1 * RAD)];
  const [d2x, d2y] = [Math.sin(az2 * RAD), Math.cos(az2 * RAD)];
  const det = d1x * -d2y - d1y * -d2x;
  if (Math.abs(det) < 1e-12) throw new GeoError('parallel');
  const [bx, by] = [p2.x - p1.x, p2.y - p1.y];
  const t1 = (bx * -d2y - by * -d2x) / det;
  const t2 = (d1x * by - d1y * bx) / det;
  return { x: p1.x + t1 * d1x, y: p1.y + t1 * d1y, along1: t1, along2: t2, behind: t1 < 0 || t2 < 0 };
}

/** Your own position from the azimuths you measured to two known landmarks: their back azimuths cross there. */
export const resect = (landmark1: Point, az1: number, landmark2: Point, az2: number) =>
  intersect(landmark1, backAzimuth(az1), landmark2, backAzimuth(az2));

export interface DeadReckoning {
  /** Nautical miles run. */
  distance: number;
  dLat: number;
  dLon: number;
  lat: number;
  lon: number;
  /** Departure: nautical miles made good to the east. */
  departure: number;
  /** The latitude whose cosine turned departure into longitude. */
  usedLat: number;
}

/**
 * A position run forward from a fix on one course and speed. Mid-latitude sailing uses the mean latitude of the
 * run; the start choice uses the latitude of the fix, as quick plotting sheets do. Both suit short runs.
 */
export function deadReckon(
  fix: { lat: number; lon: number },
  course: number,
  knots: number,
  hours: number,
  latitude: 'mid' | 'start' = 'mid',
): DeadReckoning {
  if (!(knots >= 0) || !(hours >= 0)) throw new GeoError('positive');
  if (Math.abs(fix.lat) > 89) throw new GeoError('pole');
  const distance = knots * hours;
  const dLat = (distance * Math.cos(course * RAD)) / 60;
  const departure = distance * Math.sin(course * RAD);
  const usedLat = latitude === 'mid' ? fix.lat + dLat / 2 : fix.lat;
  if (Math.abs(fix.lat + dLat) > 89) throw new GeoError('pole');
  const dLon = departure / (60 * Math.cos(usedLat * RAD));
  return { distance, dLat, dLon, lat: fix.lat + dLat, lon: fix.lon + dLon, departure, usedLat };
}

/** Where the boat goes over the ground for a heading and speed through the water and a current's set and drift. */
export function groundTrack(heading: number, speed: number, set: number, drift: number) {
  const x = speed * Math.sin(heading * RAD) + drift * Math.sin(set * RAD);
  const y = speed * Math.cos(heading * RAD) + drift * Math.cos(set * RAD);
  return { track: wrap360(Math.atan2(x, y) * DEG), speed: Math.hypot(x, y) };
}

/** The heading to steer so the current carries the boat along the wanted track, and the speed made good on it. */
export function courseToSteer(track: number, speed: number, set: number, drift: number) {
  if (!(speed > 0) || !(drift >= 0)) throw new GeoError('positive');
  const cross = (drift * Math.sin((set - track) * RAD)) / speed;
  if (Math.abs(cross) > 1) throw new GeoError('currentTooStrong');
  const correction = Math.asin(cross) * DEG;
  const heading = wrap360(track - correction);
  const made = speed * Math.cos(correction * RAD) + drift * Math.cos((set - track) * RAD);
  if (made <= 0) throw new GeoError('currentTooStrong');
  return { heading, correction: -correction, speedMadeGood: made };
}

/** The third of time, speed, and distance from the other two; pass null for the one wanted. */
export function timeSpeedDistance(hours: number | null, knots: number | null, miles: number | null) {
  const given = [hours, knots, miles].filter((value) => value !== null);
  if (given.length !== 2) throw new GeoError('twoOfThree');
  if (given.some((value) => !(value! >= 0))) throw new GeoError('positive');
  if (miles === null) return { hours: hours!, knots: knots!, miles: hours! * knots! };
  if (knots === null) {
    if (hours === 0) throw new GeoError('positive');
    return { hours: hours!, knots: miles / hours!, miles };
  }
  if (knots === 0) throw new GeoError('positive');
  return { hours: miles / knots, knots, miles };
}

/** The ground distance in meters for a distance measured on a chart of scale 1:denominator. */
export function chartDistance(measuredMeters: number, denominator: number): number {
  if (!(denominator > 0) || !(measuredMeters >= 0)) throw new GeoError('positive');
  return measuredMeters * denominator;
}
