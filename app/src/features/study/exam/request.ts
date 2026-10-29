// What the practice exam window works from (ADR 0052): the commands read the notes (a page, a section, or a
// notebook) and put them here; the window shows the settings for an exam made from them. The two choices in
// Settings live here too, on this device: whether practice exams are on, and whether the language model may write
// the questions when one is downloaded.
import { createStore } from '../../../state/store';
import type { ExamSource } from './sources';
import type { Exam } from './types';

export type ExamScope = 'page' | 'section' | 'notebook';

export interface ExamRequest {
  /** A new number for each request, so the window starts again when the same notes are asked for twice. */
  id: number;
  scope: ExamScope;
  /** The page, section, or notebook's title, for the exam's title. */
  title: string;
  sources: ExamSource[];
  /** Pages left out: protected, or not readable. */
  skipped: number;
  /** The notebook the exam pages are saved in. */
  notebookId: string | null;
  /** A saved exam to take again (stored.ts): the window opens on a fresh copy of it, not on the settings. */
  retake?: Exam;
}

export const examRequest = createStore<ExamRequest | null>(null, 'practice exam request');

let requests = 0;

export function requestExam(request: Omit<ExamRequest, 'id'>): ExamRequest {
  requests += 1;
  const made = { ...request, id: requests };
  examRequest.set(made);
  return made;
}

/** Asks the window for a fresh copy of an exam saved on a page. */
export const requestRetake = (exam: Exam, notebookId: string | null): ExamRequest =>
  requestExam({ scope: 'page', title: exam.title, sources: [], skipped: 0, notebookId, retake: exam });

const OFF_KEY = 'opennote.study.exams';
const MODEL_KEY = 'opennote.study.examsModel';

function readOff(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === 'off';
  } catch {
    return false;
  }
}

function writeOff(key: string, on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, 'off');
  } catch {
    // Storage that cannot be written keeps the choice until OpenNote closes.
  }
}

/** Whether practice exams are on (the Settings switch). On unless the person turned them off. */
export const examsOn = (): boolean => !readOff(OFF_KEY);
export const setExamsOn = (on: boolean): void => writeOff(OFF_KEY, on);

/** Whether the language model on this device may write the questions when one is downloaded. */
export const examModelOn = (): boolean => !readOff(MODEL_KEY);
export const setExamModelOn = (on: boolean): void => writeOff(MODEL_KEY, on);
