// Several timers at once, as plain data. Every function returns a new set and leaves the old one alone.

import {
  applyAction,
  configProblem,
  createTimer,
  renameTimer,
  setTimerNotify,
  settle,
  totalMs,
  viewTimer,
} from './timer';
import type { TimerAction, TimerConfig, TimerSet, TimerState, TimerStatus, TimerView } from './types';

export const EMPTY_TIMER_SET: TimerSet = { timers: [], nextId: 1 };

/** Adds an idle timer. Returns the new set and the new timer's id. */
export function addTimer(set: TimerSet, config: TimerConfig, label = ''): { set: TimerSet; id: string } {
  const id = `t${set.nextId}`;
  const timer = createTimer(id, config, label);
  return { set: { timers: [...set.timers, timer], nextId: set.nextId + 1 }, id };
}

export function removeTimer(set: TimerSet, id: string): TimerSet {
  return { ...set, timers: set.timers.filter((t) => t.id !== id) };
}

function mapTimer(set: TimerSet, id: string, change: (timer: TimerState) => TimerState): TimerSet {
  return { ...set, timers: set.timers.map((t) => (t.id === id ? change(t) : t)) };
}

export function actOnTimer(set: TimerSet, id: string, action: TimerAction, now: number): TimerSet {
  return mapTimer(set, id, (t) => applyAction(t, action, now));
}

export function renameTimerIn(set: TimerSet, id: string, label: string): TimerSet {
  return mapTimer(set, id, (t) => renameTimer(t, label));
}

export function setNotifyIn(set: TimerSet, id: string, notify: boolean): TimerSet {
  return mapTimer(set, id, (t) => setTimerNotify(t, notify));
}

/** Pauses every running timer, for example when the user taps "pause all" or the app goes to sleep. */
export function pauseAll(set: TimerSet, now: number): TimerSet {
  return { ...set, timers: set.timers.map((t) => applyAction(t, 'pause', now)) };
}

/** Settles finished timers, so the saved data says "done" rather than "running". */
export function settleAll(set: TimerSet, now: number): TimerSet {
  return { ...set, timers: set.timers.map((t) => settle(t, now)) };
}

export function viewTimers(set: TimerSet, now: number): TimerView[] {
  return set.timers.map((t) => viewTimer(t, now));
}

/** The earliest moment any running timer changes phase or finishes, or null. Use it to schedule one wake-up. */
export function nextWake(set: TimerSet, now: number): number | null {
  const times = viewTimers(set, now).flatMap((v) => (v.nextChangeAt === null ? [] : [v.nextChangeAt]));
  return times.length === 0 ? null : Math.min(...times);
}

const STATUSES: readonly TimerStatus[] = ['idle', 'running', 'paused', 'done'];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function restoreTimer(raw: unknown): TimerState | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !isObject(raw.config)) return null;
  const config = raw.config as unknown as TimerConfig;
  if (!['countdown', 'stopwatch', 'focus'].includes(config.kind) || configProblem(config)) return null;
  const status = STATUSES.find((s) => s === raw.status) ?? 'idle';
  const running = status === 'running' && isNumber(raw.runningSince);
  const timer = createTimer(raw.id, config, typeof raw.label === 'string' ? raw.label : '');
  const elapsedMs = isNumber(raw.elapsedMs) ? Math.max(0, raw.elapsedMs) : 0;
  const finishedAt = isNumber(raw.finishedAt) ? raw.finishedAt : null;
  const laps = Array.isArray(raw.laps) ? raw.laps.filter(isNumber) : [];
  const fixed = status === 'running' && !running ? 'paused' : status;
  const total = totalMs(timer.config);
  return {
    ...timer,
    status: fixed,
    elapsedMs: total === null ? elapsedMs : Math.min(elapsedMs, total),
    runningSince: running ? (raw.runningSince as number) : null,
    finishedAt: fixed === 'done' ? finishedAt : null,
    laps: timer.config.kind === 'stopwatch' ? laps : [],
    ...(raw.notify === true ? { notify: true } : {}),
  };
}

/** Rebuilds a set from saved JSON. Drops entries it can't read, so a damaged file never breaks the widget. */
export function restoreTimerSet(raw: unknown): TimerSet {
  if (!isObject(raw) || !Array.isArray(raw.timers)) return EMPTY_TIMER_SET;
  const seen = new Set<string>();
  const timers: TimerState[] = [];
  for (const item of raw.timers) {
    const timer = restoreTimer(item);
    if (!timer || seen.has(timer.id)) continue;
    seen.add(timer.id);
    timers.push(timer);
  }
  const highest = Math.max(0, ...timers.map((t) => Number(t.id.slice(1)) || 0));
  const saved = isNumber(raw.nextId) ? Math.floor(raw.nextId) : 1;
  return { timers, nextId: Math.max(saved, highest + 1, 1) };
}
