// An exam in progress (ADR 0052): the paper, every answer, the flags, the question on screen, and the timer, kept in
// this device's storage while the person works, so closing OpenNote, reloading, popping the window out, or making
// another exam does not lose them. The timer is kept as the wall-clock values it already runs on (the time left
// when it last started or paused, and when it started), so time that was paused stays paused and time that was
// running kept counting. A submitted exam's attempt is dropped. Reading and writing never throw: storage that is
// full or blocked only means the attempt is not kept.
//
// The answer key is not part of the attempt: the attempt keeps the paper only (no model answers, guides, right
// options, or fill-in words), and the key sits under its own storage name, encoded, so a look at this device's
// storage mid-exam shows no answers. It is joined to the paper again when the exam is handed in. This is not a lock:
// the key is on this device, and it has to be for the exam to be marked here.
import { keyHasUnit } from './basics';
import type { ExamTimer } from './timer';
import type { Answers, Exam, Question } from './types';

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
  /** The saved paper's page, so the results can put the exam on it for a retake. */
  paperPage?: string;
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
const KEY_PREFIX = 'opennote.study.exam.key.';
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

/** What the key holds for one question: everything the paper leaves out. */
interface KeyPart {
  answer: string;
  guide: string[];
  correct?: number;
  tolerance?: number;
  /** A fill-in question's prompt with its words in the blanks. */
  prompt?: string;
}

const BLANK_WORDS = /\{\{[^{}]+?\}\}/g;
/** What a blank holds on a paper kept without its key: the blank stays, so it is still counted and shown. */
const HIDDEN_BLANK = '{{?}}';

/** The exam as a paper without its key: no model answers, guides, right options, tolerances, or fill-in words. */
export function paperOnly(exam: Exam): Exam {
  if (exam.keyApart) return exam;
  const questions = exam.questions.map((question): Question => {
    const { correct: _correct, tolerance: _tolerance, ...rest } = question;
    return {
      ...rest,
      prompt: question.kind === 'fill' ? question.prompt.replace(BLANK_WORDS, HIDDEN_BLANK) : question.prompt,
      answer: '',
      guide: [],
      ...(question.math ? { unit: keyHasUnit(question.answer) } : {}),
    };
  });
  return { ...exam, questions, keyApart: true };
}

function keyOf(exam: Exam): Record<string, KeyPart> {
  const key: Record<string, KeyPart> = {};
  for (const question of exam.questions)
    key[question.id] = {
      answer: question.answer,
      guide: question.guide,
      ...(question.correct !== undefined ? { correct: question.correct } : {}),
      ...(question.tolerance !== undefined ? { tolerance: question.tolerance } : {}),
      ...(question.kind === 'fill' ? { prompt: question.prompt } : {}),
    };
  return key;
}

/** UTF-8 JSON as base64, so the key does not read as text in storage. */
function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(text: string): unknown {
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function readKey(storage: AttemptStorage, examId: string): Record<string, KeyPart> | null {
  try {
    const text = storage.getItem(KEY_PREFIX + examId);
    if (text === null) return null;
    const value = decode(text);
    return value !== null && typeof value === 'object' ? (value as Record<string, KeyPart>) : null;
  } catch {
    return null;
  }
}

function isKeyPart(value: unknown): value is KeyPart {
  if (value === null || typeof value !== 'object') return false;
  const part = value as Partial<KeyPart>;
  return typeof part.answer === 'string' && Array.isArray(part.guide);
}

/**
 * The paper with its key again, for marking. An exam that kept its key is given back as it is; null when the key is
 * gone or does not fit the paper.
 */
export function joinKey(exam: Exam, storage: AttemptStorage | null = deviceStorage()): Exam | null {
  if (!exam.keyApart) return exam;
  const key = storage ? readKey(storage, exam.id) : null;
  if (!key) return null;
  const questions: Question[] = [];
  for (const question of exam.questions) {
    const part = key[question.id];
    if (!isKeyPart(part)) return null;
    const { unit: _unit, ...rest } = question;
    questions.push({
      ...rest,
      answer: part.answer,
      guide: part.guide,
      ...(part.correct !== undefined ? { correct: part.correct } : {}),
      ...(part.tolerance !== undefined ? { tolerance: part.tolerance } : {}),
      ...(question.kind === 'fill' && typeof part.prompt === 'string' ? { prompt: part.prompt } : {}),
    });
  }
  const { keyApart: _apart, ...whole } = exam;
  return { ...whole, questions };
}

/** Keeps the attempt, newest first, and lets go of the oldest past MAX_ATTEMPTS. Returns false when it could not. */
export function saveAttempt(attempt: Attempt, storage: AttemptStorage | null = deviceStorage()): boolean {
  if (!storage) return false;
  try {
    // The key is written once, from the exam that still has it; a paper resumed without it leaves the key as it is.
    if (!attempt.exam.keyApart) storage.setItem(KEY_PREFIX + attempt.exam.id, encode(keyOf(attempt.exam)));
    storage.setItem(PREFIX + attempt.exam.id, JSON.stringify({ ...attempt, exam: paperOnly(attempt.exam) }));
    const index = [attempt.exam.id, ...readIndex(storage).filter((id) => id !== attempt.exam.id)];
    for (const old of index.slice(MAX_ATTEMPTS)) {
      storage.removeItem(PREFIX + old);
      storage.removeItem(KEY_PREFIX + old);
    }
    storage.setItem(INDEX, JSON.stringify(index.slice(0, MAX_ATTEMPTS)));
    return true;
  } catch {
    return false;
  }
}

/** The attempts kept on this device, newest first. Each is a paper without its key; one whose key is gone is left out. */
export function loadAttempts(storage: AttemptStorage | null = deviceStorage()): Attempt[] {
  if (!storage) return [];
  const found: Attempt[] = [];
  for (const id of readIndex(storage)) {
    try {
      const value: unknown = JSON.parse(storage.getItem(PREFIX + id) ?? 'null');
      if (isAttempt(value) && value.exam.id === id && joinKey(value.exam, storage)) found.push(value);
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
    storage.removeItem(KEY_PREFIX + examId);
    storage.setItem(INDEX, JSON.stringify(readIndex(storage).filter((id) => id !== examId)));
  } catch {
    // Nothing more to do: the attempt is offered again until it can be dropped.
  }
}
