// The exam timer (ADR 0052): a countdown that can pause, with reminders at set minutes left. It is pure state; the
// exam window reads the clock once a second and announces what is due. Running out of time never takes the paper
// away: the window says time is up and the person chooses when to submit (WCAG 2.2.1).

export interface ExamTimer {
  /** The time allowed, in milliseconds. */
  total: number;
  /** The time left when it last started or paused, in milliseconds. */
  left: number;
  /** When it last started, in milliseconds since the epoch, or null while paused. */
  since: number | null;
  /** The reminders already given, as minutes left. */
  fired: readonly number[];
}

const MINUTE = 60_000;

export function startTimer(minutes: number, now: number): ExamTimer {
  const total = Math.max(0, Math.round((Number.isFinite(minutes) ? minutes : 0) * MINUTE));
  return { total, left: total, since: now, fired: [] };
}

/** The milliseconds left at `now`, never below zero. */
export function timeLeft(timer: ExamTimer, now: number): number {
  const run = timer.since === null ? 0 : Math.max(0, now - timer.since);
  return Math.max(0, timer.left - run);
}

export const isPaused = (timer: ExamTimer): boolean => timer.since === null;
export const isOver = (timer: ExamTimer, now: number): boolean => timeLeft(timer, now) === 0;

/**
 * How long past zero the paper was handed in, in milliseconds, or null for an untimed exam or one handed in with time
 * left. A running timer keeps counting past zero on the wall clock, also while the app was closed. The clock offers no
 * pause once time is up, so a timer paused at zero was paused as it ran out and counts as just over.
 */
export function lateBy(timer: ExamTimer | null, now: number): number | null {
  if (!timer || timeLeft(timer, now) > 0) return null;
  if (timer.since === null) return 0;
  return Math.max(0, now - timer.since - timer.left);
}

export function pauseTimer(timer: ExamTimer, now: number): ExamTimer {
  if (timer.since === null) return timer;
  return { ...timer, left: timeLeft(timer, now), since: null };
}

export function resumeTimer(timer: ExamTimer, now: number): ExamTimer {
  if (timer.since !== null) return timer;
  return { ...timer, since: now };
}

/**
 * The reminders that have come due (minutes left that the clock has reached and that were not given yet), largest
 * first, and the timer with them marked as given. A reminder at or above the whole time is never given.
 */
export function dueReminders(
  timer: ExamTimer,
  reminders: readonly number[],
  now: number,
): { timer: ExamTimer; due: number[] } {
  const left = timeLeft(timer, now);
  const due = [...new Set(reminders)]
    .filter((minutes) => Number.isFinite(minutes) && minutes > 0 && minutes * MINUTE < timer.total)
    .filter((minutes) => !timer.fired.includes(minutes) && left <= minutes * MINUTE)
    .sort((a, b) => b - a);
  return due.length === 0 ? { timer, due } : { timer: { ...timer, fired: [...timer.fired, ...due] }, due };
}

/** The time left as "m:ss", or "h:mm:ss" from an hour up. */
export function clockText(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Reads "10, 5" (minutes left) into whole numbers, dropping anything else. At most 6 reminders. */
export function parseReminders(text: string): number[] {
  const found = text
    .slice(0, 200)
    .split(/[\s,;]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 300);
  return [...new Set(found)].sort((a, b) => b - a).slice(0, 6);
}
