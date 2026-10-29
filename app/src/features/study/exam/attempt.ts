// An exam in progress (ADR 0052): the paper, every answer, the flags, the question on screen, and the timer, kept in
// this device's storage while the person works, so closing OpenNote, reloading, popping the window out, or making
// another exam does not lose them. The timer is kept as the wall-clock values it already runs on (the time left
// when it last started or paused, and when it started), so time that was paused stays paused and time that was
// running kept counting. A submitted exam's attempt is dropped. Reading and writing never throw: storage that is
// full or blocked only means the attempt is not kept.
import type { ExamTimer } from './timer';
import type { Answers, Exam } from './types';

export interface Attempt {
  exam: Exam;
  answers: Answers;
  /** The timer, or null for an exam without one. */
  timer: ExamTimer | null;
  /** The question on screen when one is shown at a time. */
  at: number;
  /** The notebook the exam pages are saved in. */
  notebookId: string | null;
  /** True once the blank paper is saved as a page, so it is not saved twice. */
  paperSaved?: boolean;
  /** When it was last kept, in milliseconds since the epoch. */
  saved: number;
}

/** The part of the browser's storage an attempt uses, so tests can pass their own. */
export interface AttemptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'opennote.study.exam.attempt.';
const INDEX = 'opennote.study.exam.attempts';
/** The most attempts kept; the oldest goes first. */
export const MAX_ATTEMPTS = 5;

function deviceStorage(): AttemptStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readIndex(storage: AttemptStorage): string[] {
  try {
    const list: unknown = JSON.parse(storage.getItem(INDEX) ?? '[]');
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function isTimer(value: unknown): value is ExamTimer {
  if (value === null || typeof value !== 'object') return false;
  const timer = value as Partial<ExamTimer>;
  return (
    isNumber(timer.total) &&
    isNumber(timer.left) &&
    timer.left >= 0 &&
    timer.left <= timer.total &&
    (timer.since === null || isNumber(timer.since)) &&
    Array.isArray(timer.fired)
  );
}

/** True when what was read back has the shape of an attempt: anything else is dropped, not shown. */
export function isAttempt(value: unknown): value is Attempt {
  if (value === null || typeof value !== 'object') return false;
  const attempt = value as Partial<Attempt>;
  const exam = attempt.exam as Partial<Exam> | undefined;
  return (
    typeof exam === 'object' &&
    exam !== null &&
    typeof exam.id === 'string' &&
    typeof exam.title === 'string' &&
    Array.isArray(exam.questions) &&
    typeof exam.settings === 'object' &&
    exam.settings !== null &&
    typeof attempt.answers === 'object' &&
    attempt.answers !== null &&
    (attempt.timer === null || isTimer(attempt.timer)) &&
    isNumber(attempt.at) &&
    isNumber(attempt.saved) &&
    (attempt.notebookId === null || typeof attempt.notebookId === 'string')
  );
}

/** Keeps the attempt, newest first, and lets go of the oldest past MAX_ATTEMPTS. Returns false when it could not. */
export function saveAttempt(attempt: Attempt, storage: AttemptStorage | null = deviceStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PREFIX + attempt.exam.id, JSON.stringify(attempt));
    const index = [attempt.exam.id, ...readIndex(storage).filter((id) => id !== attempt.exam.id)];
    for (const old of index.slice(MAX_ATTEMPTS)) storage.removeItem(PREFIX + old);
    storage.setItem(INDEX, JSON.stringify(index.slice(0, MAX_ATTEMPTS)));
    return true;
  } catch {
    return false;
  }
}

/** The attempts kept on this device, newest first. */
export function loadAttempts(storage: AttemptStorage | null = deviceStorage()): Attempt[] {
  if (!storage) return [];
  const found: Attempt[] = [];
  for (const id of readIndex(storage)) {
    try {
      const value: unknown = JSON.parse(storage.getItem(PREFIX + id) ?? 'null');
      if (isAttempt(value) && value.exam.id === id) found.push(value);
    } catch {
      // A damaged attempt is skipped.
    }
  }
  return found;
}

export function dropAttempt(examId: string, storage: AttemptStorage | null = deviceStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(PREFIX + examId);
    storage.setItem(INDEX, JSON.stringify(readIndex(storage).filter((id) => id !== examId)));
  } catch {
    // Nothing more to do: the attempt is offered again until it can be dropped.
  }
}
