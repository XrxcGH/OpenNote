// UTM and MGRS (the US National Grid uses the same letters): zones of 6 degrees with the Norway and Svalbard
// exceptions, latitude bands, and 100 km square letters, by the NGA rules (public domain). Polar regions use UPS,
// which this tool does not cover.
import { GeoError } from '../geo/ellipsoid';
import { tmForward, tmInverse } from '../geo/tm';

export const K0 = 0.9996;
export const FALSE_EASTING = 500000;
export const FALSE_NORTHING_SOUTH = 10000000;

const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
const COLUMN_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

export interface Utm {
  zone: number;
  band: string;
  hemisphere: 'N' | 'S';
  easting: number;
  northing: number;
  convergence: number;
  scale: number;
}

export const centralMeridian = (zone: number) => zone * 6 - 183;

/** The UTM zone of a point, with the Norway (32V) and Svalbard (31X to 37X) exceptions. */
export function utmZone(lat: number, lon: number): number {
  const lonN = lon >= 180 ? lon - 360 : lon;
  let zone = Math.floor((lonN + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lonN >= 3 && lonN < 12) zone = 32;
  if (lat >= 72 && lat <= 84 && lonN >= 0 && lonN < 42) {
    zone = lonN < 9 ? 31 : lonN < 21 ? 33 : lonN < 33 ? 35 : 37;
  }
  return Math.min(60, zone);
}

/** The latitude band letter: C to X, 8 degrees each from 80 S, with X 12 degrees up to 84 N. */
export function band(lat: number): string {
  if (lat < -80 || lat > 84) throw new GeoError('polar');
  return BANDS[Math.min(19, Math.floor((lat + 80) / 8))];
}

export function toUtm(lat: number, lon: number, zone = utmZone(lat, lon)): Utm {
  if (lat < -80 || lat > 84) throw new GeoError('polar');
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) throw new GeoError('zone');
  const point = tmForward(lat, lon, centralMeridian(zone), K0);
  const hemisphere = lat < 0 ? 'S' : 'N';
  return {
    zone,
    band: band(lat),
    hemisphere,
    easting: FALSE_EASTING + point.x,
    northing: point.y + (hemisphere === 'S' ? FALSE_NORTHING_SOUTH : 0),
    convergence: point.convergence,
    scale: point.scale,
  };
}

export function fromUtm(zone: number, hemisphere: 'N' | 'S', easting: number, northing: number) {
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) throw new GeoError('zone');
  if (easting < 100000 || easting > 900000 || northing < 0 || northing > 10000000) throw new GeoError('utmRange');
  const y = northing - (hemisphere === 'S' ? FALSE_NORTHING_SOUTH : 0);
  return tmInverse(easting - FALSE_EASTING, y, centralMeridian(zone), K0);
}

/** The 100 km square letters of a UTM position. */
export function squareLetters(zone: number, easting: number, northing: number): string {
  const column = COLUMN_SETS[(zone - 1) % 3][Math.floor(easting / 100000) - 1];
  const row = ROWS[(Math.floor(northing / 100000) + (zone % 2 === 0 ? 5 : 0)) % 20];
  if (!column) throw new GeoError('utmRange');
  return column + row;
}

/** An MGRS reference with this many digits for each of easting and northing (5 is 1 m, 1 is 10 km). */
export function toMgrs(lat: number, lon: number, digits = 5): string {
  if (!Number.isInteger(digits) || digits < 0 || digits > 5) throw new GeoError('digits');
  const utm = toUtm(lat, lon);
  const letters = squareLetters(utm.zone, utm.easting, utm.northing);
  const unit = 10 ** (5 - digits);
  const e = Math.floor((utm.easting % 100000) / unit);
  const n = Math.floor((utm.northing % 100000) / unit);
  const pad = (value: number) => (digits === 0 ? '' : value.toString().padStart(digits, '0'));
  return `${utm.zone}${utm.band} ${letters} ${pad(e)} ${pad(n)}`.trim().replace(/\s+/g, ' ');
}

export interface MgrsPosition {
  zone: number;
  band: string;
  hemisphere: 'N' | 'S';
  easting: number;
  northing: number;
  /** The size of the square the reference names, in meters. */
  precision: number;
}

/** Reads an MGRS or USNG reference such as 18T WK 00000 27757, with or without spaces. */
export function parseMgrs(text: string): MgrsPosition {
  const compact = text.toUpperCase().replace(/\s+/g, '');
  const match = /^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/.exec(compact);
  if (!match) throw new GeoError('mgrsFormat');
  const zone = Number(match[1]);
  const bandLetter = match[2];
  const digits = match[5];
  if (zone < 1 || zone > 60 || digits.length % 2 !== 0 || digits.length > 10) throw new GeoError('mgrsFormat');
  const column = COLUMN_SETS[(zone - 1) % 3].indexOf(match[3]);
  const rowIndex = ROWS.indexOf(match[4]);
  if (column < 0) throw new GeoError('mgrsSquare');
  const half = digits.length / 2;
  const unit = 10 ** (5 - half);
  const e = half === 0 ? 0 : Number(digits.slice(0, half)) * unit;
  const n = half === 0 ? 0 : Number(digits.slice(half)) * unit;
  const easting = (column + 1) * 100000 + e;
  const hemisphere = bandLetter < 'N' ? 'S' : 'N';
  const bottom = -80 + BANDS.indexOf(bandLetter) * 8;
  const bottomNorthing = toUtm(bottom, centralMeridian(zone), zone).northing;
  let northing = ((((rowIndex - (zone % 2 === 0 ? 5 : 0)) % 20) + 20) % 20) * 100000 + n;
  while (northing < bottomNorthing - 1) northing += 2000000;
  return { zone, band: bandLetter, hemisphere, easting, northing, precision: unit };
}
