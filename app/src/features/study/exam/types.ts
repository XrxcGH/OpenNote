// The practice exam model (Study tools, ADR 0052): an exam-style paper made from the person's own notes. Each
// question carries its marks, its model answer, a marking guide, and the note it came from, so the results can point
// back to the page to read again. Nothing here is stored apart from the notes: a saved exam is a page.

export type QuestionKind = 'short' | 'choice' | 'fill' | 'worked' | 'truefalse';

export const QUESTION_KINDS: readonly QuestionKind[] = ['short', 'choice', 'fill', 'worked', 'truefalse'];

export type Difficulty = 'easier' | 'standard' | 'harder';

/** Where a question came from: the page, and the heading or term it is about. */
export interface SourceRef {
  pageId: string;
  title: string;
  /** The heading or term the question tests, for the weak-topic summary. */
  topic: string;
}

export interface Question {
  id: string;
  kind: QuestionKind;
  /** The question. A fill-in question keeps its {{blanks}}. */
  prompt: string;
  marks: number;
  /**
   * The model answer. A multiple choice question's right option, "true" or "false" for true or false, the blanks
   * joined by "; " for fill-in, and the final answer of a worked problem.
   */
  answer: string;
  /** The options of a multiple choice question, and the index of the right one. */
  choices?: string[];
  correct?: number;
  /** The points a marker looks for, one mark each unless the question has fewer marks than points. */
  guide: string[];
  /** True when the answer is a number or an expression, which is marked by its value. */
  math?: boolean;
  /** How far a numeric answer may be from the model answer, as a share of it (0.01 is 1 percent). */
  tolerance?: number;
  source: SourceRef;
}

export interface ExamSettings {
  /** How many questions. */
  length: number;
  difficulty: Difficulty;
  kinds: readonly QuestionKind[];
  /** The time allowed, or null for no timer. */
  minutes: number | null;
  /** Minutes left at which to remind the person, such as [10, 5]. */
  reminders: readonly number[];
}

export interface Exam {
  id: string;
  title: string;
  /** When the exam was made, as an ISO date and time. */
  created: string;
  settings: ExamSettings;
  questions: Question[];
  /** Who wrote the questions: the rules, or the language model on this device. */
  engine: 'rules' | 'model';
}

/** One point of a stroke written in an answer area, in the area's own pixels. */
export type InkPoint = readonly [x: number, y: number];

export interface Answer {
  /** A typed answer: a short answer, or the final answer of a worked problem. */
  text?: string;
  /** The working of a worked problem. */
  working?: string;
  /** One for each blank of a fill-in question. */
  blanks?: string[];
  /** The option picked: an index into the choices, or 0 for true and 1 for false. */
  picked?: number;
  /** Strokes written in the answer area. */
  ink?: InkPoint[][];
  flagged?: boolean;
}

export type Answers = Record<string, Answer>;

export type MarkStatus = 'right' | 'partial' | 'wrong' | 'unmarked';

export interface QuestionMark {
  id: string;
  got: number;
  of: number;
  /** True when the app marked it; false when the person marks it with the key beside their answer. */
  auto: boolean;
  status: MarkStatus;
  /** Why the app marked it so, such as a missing unit. */
  note?: 'unit' | 'close' | 'blank' | 'unreadable';
}

export const DEFAULT_SETTINGS: ExamSettings = {
  length: 10,
  difficulty: 'standard',
  kinds: QUESTION_KINDS,
  minutes: null,
  reminders: [10, 5],
};

/** The most questions one exam asks, and the longest time it allows. */
export const MAX_QUESTIONS = 40;
export const MAX_MINUTES = 300;
