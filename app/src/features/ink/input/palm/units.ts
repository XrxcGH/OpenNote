// CSS pixels to millimeters. Pointer Events report client CSS px, which are a different physical size on every
// screen: 76 px is about 20 mm at 96 px per inch, 14.6 mm on an iPad, and 12 mm on a phone. Every threshold in the
// classifier is in millimeters, so the scale must come from the device.

import { clamp, DEFAULT_PX_PER_MM, MAX_PX_PER_MM, MIN_PX_PER_MM } from './thresholds';

const usable = (v: number | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= MIN_PX_PER_MM && v <= MAX_PX_PER_MM;

/**
 * CSS px per millimeter: the native hint (monitor size over its scale factor), else the Palm lab calibration along a
 * bank card, else the default. A value outside 2 to 20 is not trusted.
 */
export function resolvePxPerMm(native?: number, calibrated?: number): number {
  if (usable(native)) return native;
  if (usable(calibrated)) return calibrated;
  return DEFAULT_PX_PER_MM;
}

/** CSS px per mm from a measured drag along a known length, such as a bank card's long edge (85.6 mm). */
export function calibratePxPerMm(draggedPx: number, lengthMm = 85.6): number {
  return clamp(draggedPx / lengthMm, MIN_PX_PER_MM, MAX_PX_PER_MM);
}
