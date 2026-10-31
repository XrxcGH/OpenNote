// Marking a practice exam (ADR 0052). Multiple choice, true or false, and fill-in answers are marked by the app, and
// so are answers that are numbers or math, by their value (equivalence.ts). Short answers in words and the method of a
// worked problem are marked by the person, with the key and the marking guide beside their answer. The totals and the
// weak-topic summary count only what has been marked.
import { normalize } from '../deck/quiz';
import { blanksOfQuestion, isAnswered } from './basics';
import { compareMath, readsAsMath } from './equivalence';
import type { MathKit } from './equivalence';
import type { Answer, Answers, Exam, MarkStatus, Question, QuestionMark } from './types';

/** The ways one answer may be written: "H2O / water" and "H2O; water" accept either. */
function accepted(answer: string): string[] {
  return answer
    .split(/\s+\/\s+|;|\|/)
    .map(normalize)
    .filter(Boolean);
}

export { blanksOfQuestion, isAnswered };

const statusOf = (got: number, of: number): MarkStatus => (got >= of ? 'right' : got > 0 ? 'partial' : 'wrong');

const mark = (question: Question, got: number, note?: QuestionMark['note']): QuestionMark => ({
  id: question.id,
  got,
  of: question.marks,
  auto: true,
  status: statusOf(got, question.marks),
  ...(note ? { note } : {}),
});

/** Whether a typed blank matches what the key has for it: by value for numbers, else by its words. */
function blankRight(typed: string, expected: string, kit: MathKit): boolean {
  if (normalize(typed) === '') return false;
  if (readsAsMath(expected, kit)) {
    const verdict = compareMath(typed, expected, kit, 0.005);
    if (verdict === 'equal' || verdict === 'close') return true;
  }
  return accepted(expected).includes(normalize(typed));
}

/**
 * The app's mark for one answer, or null when the person marks it: a short answer in words, a handwritten answer, or
 * a worked problem whose final answer is not right (its method can still earn marks).
 */
export function autoMark(question: Question, answer: Answer | undefined, kit: MathKit): QuestionMark | null {
  const marks = question.marks;
  if (question.kind === 'choice') {
    if (answer?.picked === undefined) return mark(question, 0, 'blank');
    return mark(question, answer.picked === question.correct ? marks : 0);
  }
  if (question.kind === 'truefalse') {
    if (answer?.picked === undefined) return mark(question, 0, 'blank');
    const said = answer.picked === 0 ? 'true' : 'false';
    return mark(question, said === question.answer ? marks : 0);
  }
  if (question.kind === 'fill') {
    const expected = blanksOfQuestion(question);
    const typed = answer?.blanks ?? [];
    if (expected.length === 0) return null;
    if (!typed.some((blank) => blank.trim() !== '')) return mark(question, 0, 'blank');
    const right = expected.filter((want, at) => blankRight(typed[at] ?? '', want, kit)).length;
    return mark(question, Math.round((marks * right) / expected.length));
  }
  const text = (answer?.text ?? '').trim();
  if (!isAnswered(question, answer)) return mark(question, 0, 'blank');
  if (!question.math || text === '') return null;
  const verdict = compareMath(text, question.answer, kit, question.tolerance ?? 0);
  if (verdict === 'equal') return mark(question, marks);
  if (verdict === 'close') return mark(question, marks, 'close');
  // A worked problem's method earns marks even when the final answer is off, so the person marks it.
  if (question.kind === 'worked') return null;
  if (verdict === 'unit') return mark(question, Math.max(0, marks - 1), 'unit');
  if (verdict === 'unreadable') return null;
  return mark(question, 0);
}

/** A mark the person gave, kept within the question's marks and to whole marks. */
export function selfMark(question: Question, got: number): QuestionMark {
  const whole = Number.isFinite(got) ? Math.round(got) : 0;
  const clamped = Math.max(0, Math.min(question.marks, whole));
  return { id: question.id, got: clamped, of: question.marks, auto: false, status: statusOf(clamped, question.marks) };
}

/** Marks every answer the app can, and leaves the rest unmarked for the person. */
export function markExam(exam: Exam, answers: Answers, kit: MathKit): Record<string, QuestionMark> {
  const marks: Record<string, QuestionMark> = {};
  for (const question of exam.questions) {
    marks[question.id] = autoMark(question, answers[question.id], kit) ?? {
      id: question.id,
      got: 0,
      of: question.marks,
      auto: false,
      status: 'unmarked',
    };
  }
  return marks;
}

export interface Totals {
  got: number;
  /** All the marks of the exam. */
  of: number;
  /** Whole percent of all the marks. */
  percent: number;
  /** Questions still to be marked by the person. */
  unmarked: number;
}

export function totals(exam: Exam, marks: Readonly<Record<string, QuestionMark>>): Totals {
  let got = 0;
  let of = 0;
  let unmarked = 0;
  for (const question of exam.questions) {
    of += question.marks;
    const one = marks[question.id];
    if (!one || one.status === 'unmarked') unmarked += 1;
    else got += one.got;
  }
  return { got, of, percent: of === 0 ? 0 : Math.round((got / of) * 100), unmarked };
}

export interface WeakTopic {
  topic: string;
  pageId: string;
  title: string;
  got: number;
  of: number;
}

/** The share of marks below which a topic is weak. */
const WEAK = 0.6;

/** The topics with less than 60 percent of their marked marks, weakest first, each with the page it came from. */
export function weakTopics(exam: Exam, marks: Readonly<Record<string, QuestionMark>>, most = 8): WeakTopic[] {
  const byTopic = new Map<string, WeakTopic>();
  for (const question of exam.questions) {
    const one = marks[question.id];
    if (!one || one.status === 'unmarked') continue;
    const key = `${question.source.pageId}|${question.source.topic.toLowerCase()}`;
    const entry = byTopic.get(key) ?? {
      topic: question.source.topic,
      pageId: question.source.pageId,
      title: question.source.title,
      got: 0,
      of: 0,
    };
    entry.got += one.got;
    entry.of += one.of;
    byTopic.set(key, entry);
  }
  return [...byTopic.values()]
    .filter((entry) => entry.of > 0 && entry.got / entry.of < WEAK)
    .sort((a, b) => a.got / a.of - b.got / b.of || a.topic.localeCompare(b.topic))
    .slice(0, most);
}

/** The questions that did not get all their marks, in paper order. */
export function missedQuestions(exam: Exam, marks: Readonly<Record<string, QuestionMark>>): Question[] {
  return exam.questions.filter((question) => {
    const one = marks[question.id];
    return one !== undefined && one.status !== 'unmarked' && one.got < one.of;
  });
}
