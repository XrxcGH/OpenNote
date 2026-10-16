// The focus timer's schedule: work, break, work, break, ..., work. All of it follows from the elapsed time.

import type { FocusConfig, FocusPhase } from './types';

export interface FocusPosition {
  phase: FocusPhase;
  phaseIndex: number;
  cycle: number;
  phaseLeftMs: number;
}

/** The active time from the first work period to the end of the last. */
export function focusTotalMs(config: FocusConfig): number {
  return config.cycles * config.workMs + (config.cycles - 1) * config.breakMs;
}

/** Where a focus timer is after this much active time, or null once it has finished. */
export function focusPosition(config: FocusConfig, elapsedMs: number): FocusPosition | null {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed >= focusTotalMs(config)) return null;
  const length = config.workMs + config.breakMs;
  const index = Math.floor(elapsed / length);
  const into = elapsed - index * length;
  if (into < config.workMs) {
    return { phase: 'work', phaseIndex: index * 2, cycle: index + 1, phaseLeftMs: config.workMs - into };
  }
  return { phase: 'break', phaseIndex: index * 2 + 1, cycle: index + 1, phaseLeftMs: length - into };
}
