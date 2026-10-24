// Degrees, minutes, and seconds: reading what people type (40 26 45.6 N, 40°26'45.6", -73.5, N 40 26.76) and
// writing degrees back out with the carry done right, so 59.99 seconds never shows as 60.
import { GeoError } from '../geo/ellipsoid';

export type AngleKind = 'lat' | 'lon';

export interface Dms {
  negative: boolean;
  degrees: number;
  minutes: number;
  seconds: number;
}

/** Splits decimal degrees into whole degrees, whole minutes, and seconds rounded to this many decimals. */
export function toDms(value: number, decimals = 1): Dms {
  if (!Number.isFinite(value)) throw new GeoError('number');
  const negative = value < 0;
  const factor = 10 ** decimals;
  const totalSeconds = Math.round(Math.abs(value) * 3600 * factor) / factor;
  const degrees = Math.floor(totalSeconds / 3600 + 1e-12);
  const minutes = Math.floor((totalSeconds - degrees * 3600) / 60 + 1e-12);
  const seconds = Math.round((totalSeconds - degrees * 3600 - minutes * 60) * factor) / factor;
  return { negative, degrees, minutes, seconds };
}

/** Degrees as 40° 26′ 45.6″, with a hemisphere letter when the kind is given. */
export function formatDms(value: number, decimals = 1, kind?: AngleKind): string {
  const { negative, degrees, minutes, seconds } = toDms(value, decimals);
  const body = `${degrees}° ${minutes}′ ${seconds.toFixed(decimals)}″`;
  if (!kind) return negative ? `-${body}` : body;
  const letter = kind === 'lat' ? (negative ? 'S' : 'N') : negative ? 'W' : 'E';
  return `${body} ${letter}`;
}

/** Degrees and decimal minutes, as 40° 26.760′ N. */
export function formatDm(value: number, decimals = 3, kind?: AngleKind): string {
  const negative = value < 0;
  const factor = 10 ** decimals;
  const totalMinutes = Math.round(Math.abs(value) * 60 * factor) / factor;
  const degrees = Math.floor(totalMinutes / 60 + 1e-12);
  const minutes = totalMinutes - degrees * 60;
  const body = `${degrees}° ${minutes.toFixed(decimals)}′`;
  if (!kind) return negative ? `-${body}` : body;
  return `${body} ${kind === 'lat' ? (negative ? 'S' : 'N') : negative ? 'W' : 'E'}`;
}

/** Reads an angle typed in decimal degrees, degrees and minutes, or degrees, minutes and seconds. */
export function parseAngle(text: string, kind: AngleKind): number {
  // Lowercase d, m, and s straight after a number are unit marks, as in 40d 26m 45.6s; letters elsewhere are hemispheres.
  const marked = text.trim().replace(/(\d)\s*[dms](?![a-z])/g, '$1 ');
  const upper = marked.toUpperCase().replace(/,/g, '.');
  if (upper === '') throw new GeoError('empty');
  const letters = upper.replace(/[^NSEW]/g, '');
  if (letters.length > 1) throw new GeoError('hemisphere');
  if (letters && (kind === 'lat' ? !'NS'.includes(letters) : !'EW'.includes(letters))) throw new GeoError('hemisphere');
  const rest = upper.replace(/[NSEW]/g, ' ');
  if (/[^0-9.+\-\s°'"′″’”]/.test(rest)) throw new GeoError('angleFormat');
  const numbers = rest.match(/[-+]?\d+(?:\.\d+)?|[-+]?\.\d+/g) ?? [];
  if (numbers.length === 0 || numbers.length > 3) throw new GeoError('angleFormat');
  const parts = numbers.map(Number);
  const minus = parts[0] < 0 || Object.is(parts[0], -0) || (numbers[0] ?? '').startsWith('-');
  const [d, m = 0, s = 0] = parts.map(Math.abs);
  if (parts.slice(1).some((part) => part < 0)) throw new GeoError('angleFormat');
  if (m >= 60 || s >= 60) throw new GeoError('minutesRange');
  if (numbers.length > 1 && !Number.isInteger(d)) throw new GeoError('angleFormat');
  if (numbers.length > 2 && !Number.isInteger(m)) throw new GeoError('angleFormat');
  if (minus && (letters === 'S' || letters === 'W' || letters === 'N' || letters === 'E')) {
    throw new GeoError('hemisphere');
  }
  const magnitude = d + m / 60 + s / 3600;
  const value = (minus || letters === 'S' || letters === 'W' ? -1 : 1) * magnitude;
  if (Math.abs(value) > (kind === 'lat' ? 90 : 180)) throw new GeoError(kind === 'lat' ? 'latitude' : 'longitude');
  return value;
}
