// One timer as pure functions: (state, clock reading) in, new state out. A timer saves only the active time it
// has already counted and when its current run began, so "time left" is always derived from the clock.

import { focusPosition, focusTotalMs } from './focus';
import type { FocusView, TimerAction, TimerConfig, TimerState, TimerView } from './types';

export const MAX_CYCLES = 99;

export type ConfigProblem = 'duration' | 'work' | 'break' | 'cycles';

const isPositive = (n: number) => Number.isFinite(n) && n >= 1;

/** What is wrong with a timer configuration, or null if it is fine. */
export function configProblem(config: TimerConfig): ConfigProblem | null {
  if (config.kind === 'countdown') return isPositive(config.durationMs) ? null : 'duration';
  if (config.kind === 'stopwatch') return null;
  if (!isPositive(config.workMs)) return 'work';
  if (!isPositive(config.breakMs)) return 'break';
  const whole = Number.isInteger(config.cycles);
  return whole && config.cycles >= 1 && config.cycles <= MAX_CYCLES ? null : 'cycles';
}

function normalized(config: TimerConfig): TimerConfig {
  if (config.kind === 'countdown') return { kind: 'countdown', durationMs: Math.round(config.durationMs) };
  if (config.kind === 'stopwatch') return { kind: 'stopwatch' };
  const { workMs, breakMs, cycles } = config;
  return { kind: 'focus', workMs: Math.round(workMs), breakMs: Math.round(breakMs), cycles };
}

/** A new idle timer. Throws a RangeError for a bad configuration, so check it with configProblem first. */
export function createTimer(id: string, config: TimerConfig, label = ''): TimerState {
  const problem = configProblem(config);
  if (problem) throw new RangeError(`Bad timer configuration: ${problem}`);
  return {
    id,
    label: label.trim(),
    config: normalized(config),
    status: 'idle',
    elapsedMs: 0,
    runningSince: null,
    finishedAt: null,
    laps: [],
  };
}

/** The active time at which the timer ends, or null for a stopwatch. */
export function totalMs(config: TimerConfig): number | null {
  if (config.kind === 'countdown') return config.durationMs;
  return config.kind === 'focus' ? focusTotalMs(config) : null;
}

function rawElapsed(state: TimerState, now: number): number {
  const run = state.runningSince === null ? 0 : Math.max(0, now - state.runningSince);
  return state.elapsedMs + run;
}

/** The active time counted so far, never more than the total. */
export function elapsedAt(state: TimerState, now: number): number {
  const total = totalMs(state.config);
  const elapsed = rawElapsed(state, now);
  return total === null ? elapsed : Math.min(elapsed, total);
}

/** Marks a running timer as done if its time has run out, and records when that happened. */
export function settle(state: TimerState, now: number): TimerState {
  const total = totalMs(state.config);
  if (state.status !== 'running' || state.runningSince === null || total === null) return state;
  if (rawElapsed(state, now) < total) return state;
  const finishedAt = state.runningSince + (total - state.elapsedMs);
  return { ...state, status: 'done', elapsedMs: total, runningSince: null, finishedAt };
}

function start(state: TimerState, now: number): TimerState {
  return state.status === 'idle' ? { ...state, status: 'running', runningSince: now } : state;
}

function pause(state: TimerState, now: number): TimerState {
  const settled = settle(state, now);
  if (settled.status !== 'running') return settled;
  return { ...settled, status: 'paused', elapsedMs: elapsedAt(settled, now), runningSince: null };
}

function resume(state: TimerState, now: number): TimerState {
  const settled = settle(state, now);
  return settled.status === 'paused' ? { ...settled, status: 'running', runningSince: now } : settled;
}

function reset(state: TimerState): TimerState {
  return { ...state, status: 'idle', elapsedMs: 0, runningSince: null, finishedAt: null, laps: [] };
}

function lap(state: TimerState, now: number): TimerState {
  if (state.config.kind !== 'stopwatch' || state.status !== 'running') return state;
  return { ...state, laps: [...state.laps, elapsedAt(state, now)] };
}

/** Applies a user action. One that does not fit the status, such as pausing an idle timer, does nothing. */
export function applyAction(state: TimerState, action: TimerAction, now: number): TimerState {
  switch (action) {
    case 'start':
      return start(state, now);
    case 'pause':
      return pause(state, now);
    case 'resume':
      return resume(state, now);
    case 'reset':
      return reset(state);
    case 'lap':
      return lap(state, now);
  }
}

export function setTimerNotify(state: TimerState, notify: boolean): TimerState {
  return { ...state, notify };
}

export function renameTimer(state: TimerState, label: string): TimerState {
  return { ...state, label: label.trim() };
}

function focusView(state: TimerState, elapsed: number, now: number): FocusView | null {
  if (state.config.kind !== 'focus') return null;
  const position = focusPosition(state.config, elapsed);
  if (!position) return null;
  const running = state.status === 'running';
  return {
    phase: position.phase,
    phaseIndex: position.phaseIndex,
    cycle: position.cycle,
    cycles: state.config.cycles,
    phaseLeftMs: position.phaseLeftMs,
    phaseEndsAt: running ? now + position.phaseLeftMs : null,
  };
}

/** What the timer shows at this clock reading. */
export function viewTimer(timer: TimerState, now: number): TimerView {
  const state = settle(timer, now);
  const elapsedMs = elapsedAt(state, now);
  const total = totalMs(state.config);
  const leftMs = total === null ? null : total - elapsedMs;
  const running = state.status === 'running';
  const focus = focusView(state, elapsedMs, now);
  const endsAt = running && leftMs !== null ? now + leftMs : null;
  return {
    id: state.id,
    label: state.label,
    kind: state.config.kind,
    status: state.status,
    elapsedMs,
    leftMs,
    endsAt,
    finishedAt: state.finishedAt,
    nextChangeAt: focus?.phaseEndsAt ?? endsAt,
    focus,
    laps: state.laps,
    notify: state.notify === true,
  };
}
