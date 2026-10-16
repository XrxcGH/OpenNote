// The stroke the engine works with: the geometry's stroke plus the parts of a record the geometry never reads
// (spec 9.3). The raw points are decoded to page units, and everything else a record stores rides along, so a
// stroke encodes back to the record it came from.

import type { Stroke } from '../geometry/types';
import type { Rgba } from '../pens/palette';

export interface InkStroke extends Stroke {
  /** The ID of the ink block that holds the stroke. */
  readonly block: string;
  /** The palette slot: 0 for a color the person chose, 1 to 7 the pens, 32 to 36 the highlighters. */
  readonly slot: number;
  /** The light-theme color, with straight alpha. It stays the authority for printing and export. */
  readonly color: Rgba;
  /**
   * The record's tool byte when a newer version wrote one this version does not know. The stroke draws as a pen, and
   * the byte survives a save (spec 9.3).
   */
  readonly toolCode?: number;
  /** True for imported ink whose start time is not known (spec 9.3, flag bit 5). */
  readonly startUnknown?: boolean;
}

/** Quantization steps of the record's point data (spec 9.4). */
export const POSITION_STEPS_PER_UNIT = 64;
export const PRESSURE_MAX = 65535;
export const TILT_STEPS_PER_DEGREE = 100;
/** One time step is 100 microseconds, so ten make a millisecond. */
export const TIME_STEPS_PER_MS = 10;
/** The largest coordinate a record can hold, in page units: 2^29 steps of 1/64. */
export const MAX_COORDINATE = 2 ** 29 / POSITION_STEPS_PER_UNIT;
