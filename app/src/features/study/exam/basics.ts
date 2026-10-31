// The small parts of practice exams the exam window needs before the questions are marked: the settings' bounds,
// whether a question has an answer, its blanks, and the letters of its options. They load without the math engine.
import { blanksOf } from '../deck/cloze';
import { MAX_MINUTES, MAX_QUESTIONS } from './types';
import type { Answer, ExamSettings, Question } from './types';

const LETTERS = 'ABCDEFGH';

/** The letter of an option: A, B, C, and so on. */
export const letterOf = (index: number): string => LETTERS[index] ?? String(index + 1);

/** The question count asked for, kept from 1 to the most an exam has. */
export function examLength(wanted: number): number {
  return Math.max(1, Math.min(MAX_QUESTIONS, Number.isFinite(wanted) ? Math.round(wanted) : 10));
}

/** The settings with every number kept to what an exam allows. */
export function cleanSettings(settings: ExamSettings): ExamSettings {
  const minutes =
    settings.minutes === null || !Number.isFinite(settings.minutes) || settings.minutes <= 0
      ? null
      : Math.min(MAX_MINUTES, Math.round(settings.minutes));
  return {
    ...settings,
    length: examLength(settings.length),
    minutes,
    reminders: minutes === null ? [] : settings.reminders.filter((at) => at > 0 && at < minutes),
  };
}

/** The answers the key has for each blank of a fill-in question. */
export function blanksOfQuestion(question: Question): string[] {
  return question.kind === 'fill' ? blanksOf(question.prompt) : [];
}

/** True when the person has given any answer to the question. */
export function isAnswered(question: Question, answer: Answer | undefined): boolean {
  if (!answer) return false;
  if (question.kind === 'choice' || question.kind === 'truefalse') return answer.picked !== undefined;
  if (question.kind === 'fill') return (answer.blanks ?? []).some((blank) => blank.trim() !== '');
  return (answer.text ?? '').trim() !== '' || (answer.working ?? '').trim() !== '' || (answer.ink ?? []).length > 0;
}

/**
 * True when a math key is a number with a unit after it, such as "5 m", "9.8 m/s^2" or "20 °C", so the answer field
 * can say up front that the unit is marked. A letter straight after the number ("2x") is a variable, not a unit.
 */
export function keyHasUnit(answer: string): boolean {
  return /^[-+−]?\d[\d.,]*(?:[eE][-+]?\d+)?(?:\s+[A-Za-zµμΩ°]|\s*°)[^+=<>]*$/.test(answer.trim());
}
