// A submitted exam kept on its pages, so it can be taken again (ADR 0052). When the results are saved, the paper,
// the key, and the results pages each hold the whole exam with its key in the page's view under one name; it is
// written only then, so the notebook holds no key while the exam is being taken. "Retake this practice exam" reads
// it back from the page on screen and opens a fresh copy: the same questions, a new id, no answers.
import { QUESTION_KINDS } from './types';
import type { Exam, Question } from './types';

/** The name the exam is kept under in a page's view. */
export const EXAM_VIEW_KEY = 'practiceExam';
const VERSION = 1;

export interface StoredExam {
  version: number;
  exam: Exam;
}

/** What goes in the page's view: the exam with its key. */
export function storedExam(exam: Exam): Record<string, StoredExam> {
  const { keyApart: _apart, ...whole } = exam;
  return { [EXAM_VIEW_KEY]: { version: VERSION, exam: whole } };
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function isQuestion(value: unknown): value is Question {
  if (value === null || typeof value !== 'object') return false;
  const one = value as Partial<Question>;
  const source = one.source as Partial<Question['source']> | undefined;
  return (
    isString(one.id) &&
    QUESTION_KINDS.includes(one.kind as Question['kind']) &&
    isString(one.prompt) &&
    isNumber(one.marks) &&
    one.marks > 0 &&
    isString(one.answer) &&
    Array.isArray(one.guide) &&
    one.guide.every(isString) &&
    (one.choices === undefined || (Array.isArray(one.choices) && one.choices.every(isString))) &&
    (one.correct === undefined || isNumber(one.correct)) &&
    (one.tolerance === undefined || isNumber(one.tolerance)) &&
    typeof source === 'object' &&
    source !== null &&
    isString(source.pageId) &&
    isString(source.title) &&
    isString(source.topic)
  );
}

/**
 * The exam a page's view holds, or null when it holds none, or one that is damaged, from a newer OpenNote, or
 * without its key (only a whole exam can be marked).
 */
export function readStoredExam(view: unknown): Exam | null {
  if (view === null || typeof view !== 'object') return null;
  const stored = (view as Record<string, unknown>)[EXAM_VIEW_KEY] as Partial<StoredExam> | undefined;
  if (!stored || typeof stored !== 'object' || stored.version !== VERSION) return null;
  const exam = stored.exam as Partial<Exam> | undefined;
  if (!exam || typeof exam !== 'object' || exam.keyApart) return null;
  const settings = exam.settings as Partial<Exam['settings']> | undefined;
  const fits =
    isString(exam.id) &&
    isString(exam.title) &&
    isString(exam.created) &&
    (exam.engine === 'rules' || exam.engine === 'model') &&
    typeof settings === 'object' &&
    settings !== null &&
    isNumber(settings.length) &&
    // A page's view takes merge patches (RFC 7396), where null means "remove", so an untimed exam comes back
    // with no minutes at all.
    (settings.minutes === undefined || settings.minutes === null || isNumber(settings.minutes)) &&
    Array.isArray(settings.kinds) &&
    Array.isArray(settings.reminders) &&
    Array.isArray(exam.questions) &&
    exam.questions.length > 0 &&
    exam.questions.every(isQuestion);
  if (!fits) return null;
  const whole = exam as Exam;
  return { ...whole, settings: { ...whole.settings, minutes: whole.settings.minutes ?? null } };
}

/** A fresh copy of a saved exam to take again: the same questions and settings, a new id, made now. */
export function retakeOf(exam: Exam, now: Date = new Date()): Exam {
  const { keyApart: _apart, ...whole } = exam;
  const id = `exam-${now.getTime().toString(36)}-r${Math.floor(Math.random() * 1e6).toString(36)}`;
  return { ...whole, id, created: now.toISOString() };
}
