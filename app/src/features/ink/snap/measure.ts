// Measuring on the page: the ruler's tick marks in centimeters or inches, the length of a line or of two marked points
// in those units, and which units a place uses. Pure numbers on page units, so a Node test drives it.
import { PAGE_UNITS_PER_MM } from '../geometry/stabilizer';
import type { Vec } from '../geometry/types';

export type LengthUnits = 'metric' | 'imperial';
/** The person's choice: follow the language and region of the app, or one set of units. */
export type UnitsChoice = 'auto' | LengthUnits;

export const PAGE_UNITS_PER_INCH = PAGE_UNITS_PER_MM * 25.4;

/** The regions that measure in inches: the United States, Liberia, and Myanmar. */
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);

/** The units a locale such as `en-US` or `de-DE` measures in. A locale without a region is metric. */
export function unitsForLocale(locale: string): LengthUnits {
  const parts = locale.replace(/_/g, '-').split('-');
  const region = parts.slice(1).find((part) => /^[A-Za-z]{2}$/.test(part));
  return region && IMPERIAL_REGIONS.has(region.toUpperCase()) ? 'imperial' : 'metric';
}

export function resolveUnits(choice: UnitsChoice, locale: string): LengthUnits {
  // A choice synced from another device is checked again here, so an unknown one reads as automatic.
  return choice === 'metric' || choice === 'imperial' ? choice : unitsForLocale(locale);
}

/** A length in page units as a number in the units' main unit: centimeters or inches. */
export function lengthIn(pageUnits: number, units: LengthUnits): { value: number; unit: 'cm' | 'in' } {
  return units === 'imperial'
    ? { value: pageUnits / PAGE_UNITS_PER_INCH, unit: 'in' }
    : { value: pageUnits / (PAGE_UNITS_PER_MM * 10), unit: 'cm' };
}

/** A length rounded to what a ruler can show: a millimeter, or a sixteenth of an inch written as a decimal. */
export function roundedLength(pageUnits: number, units: LengthUnits): { value: number; unit: 'cm' | 'in' } {
  const { value, unit } = lengthIn(pageUnits, units);
  const rounded = unit === 'cm' ? Math.round(value * 10) / 10 : Math.round(value * 16) / 16;
  return { value: Object.is(rounded, -0) ? 0 : rounded, unit };
}

/** The distance between two points, in page units. */
export function distance(a: Vec, b: Vec): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The length along a drawn line, corner to corner, in page units. */
export function polylineLength(points: readonly Vec[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1]!, points[i]!);
  return total;
}

/** The angle of the line from `a` to `b`, in whole degrees from 0 up to 360, counterclockwise as on paper. */
export function lineAngle(a: Vec, b: Vec): number {
  const deg = (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;
  return Math.round(((deg % 360) + 360) % 360) % 360;
}

export interface Tick {
  /** Along the ruler from its left end, in page units. */
  readonly at: number;
  /** A major tick is a centimeter or an inch, and carries its number. */
  readonly size: 'minor' | 'mid' | 'major';
  readonly label?: string;
}

/**
 * The ticks along a ruler of `length` page units, from its left end: every millimeter with a longer one at each half
 * centimeter and a numbered one at each centimeter, or every sixteenth of an inch with longer ones at each half and
 * quarter and a numbered one at each inch.
 */
export function rulerTicks(length: number, units: LengthUnits): Tick[] {
  const ticks: Tick[] = [];
  const step = units === 'imperial' ? PAGE_UNITS_PER_INCH / 16 : PAGE_UNITS_PER_MM;
  const per = units === 'imperial' ? 16 : 10;
  const count = Math.floor(length / step + 1e-9);
  for (let i = 0; i <= count; i += 1) {
    const at = i * step;
    if (i % per === 0) ticks.push({ at, size: 'major', label: String(i / per) });
    else if (i % (per / 2) === 0 || (units === 'imperial' && i % 4 === 0)) ticks.push({ at, size: 'mid' });
    else ticks.push({ at, size: 'minor' });
  }
  return ticks;
}

/** One step of the keyboard's ruler and compass moves: a millimeter, or a sixteenth of an inch. */
export function unitStep(units: LengthUnits): number {
  return units === 'imperial' ? PAGE_UNITS_PER_INCH / 16 : PAGE_UNITS_PER_MM;
}
