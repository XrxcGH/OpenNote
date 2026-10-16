// Level meters for the recording indicator. The host reports the loudest sample since the last poll. These functions
// turn it into what a screen draws: decibels, a bar that rises at once and falls slowly, and a peak mark that holds
// for a moment. They are plain functions of the time that passed, so a test needs no timers.

import type { Level } from './types';

/** The quietest level a meter shows. */
export const FLOOR_DB = -60;
/** How fast the bar falls, in decibels a second. */
const FALL_DB_PER_SECOND = 24;
/** How long the peak mark stays, in milliseconds. */
const HOLD_MS = 1_200;

/** A linear level from 0 to 1 in decibels, never below the meter's floor. */
export function toDb(level: number): number {
  return level <= 0 ? FLOOR_DB : Math.max(20 * Math.log10(level), FLOOR_DB);
}

/** Where a level falls on a meter from the floor to full scale, from 0 to 1. */
export function fraction(db: number): number {
  return Math.min(Math.max((db - FLOOR_DB) / -FLOOR_DB, 0), 1);
}

export interface MeterState {
  /** The bar, in decibels. */
  barDb: number;
  /** The peak mark, in decibels. */
  holdDb: number;
  /** Milliseconds the peak mark has stayed. */
  heldMs: number;
  /** Whether the track clipped lately. The screen keeps it lit until the person looks. */
  clipped: boolean;
}

export const QUIET: MeterState = { barDb: FLOOR_DB, holdDb: FLOOR_DB, heldMs: 0, clipped: false };

/** The state of a meter after `elapsedMs` and a new reading from the host. */
export function advance(state: MeterState, level: Level | undefined, elapsedMs: number): MeterState {
  const peakDb = level ? toDb(level.peak) : FLOOR_DB;
  const fallen = state.barDb - (FALL_DB_PER_SECOND * elapsedMs) / 1_000;
  const barDb = Math.max(peakDb, fallen, FLOOR_DB);
  const heldMs = state.heldMs + elapsedMs;
  const holdOn = barDb >= state.holdDb || heldMs > HOLD_MS;
  return {
    barDb,
    holdDb: holdOn ? barDb : state.holdDb,
    heldMs: holdOn ? 0 : heldMs,
    clipped: state.clipped || (level?.clipped ?? false),
  };
}
