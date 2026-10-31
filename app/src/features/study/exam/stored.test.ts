// A submitted exam kept in its pages' view for a retake: it comes back whole, anything damaged, newer, or without its
// key is refused, and a retake is the same questions under a new id.
import { describe, expect, it } from 'vitest';
import { paperOnly } from './attempt';
import { EXAM_VIEW_KEY, readStoredExam, retakeOf, storedExam } from './stored';
import type { Exam } from './types';
import { DEFAULT_SETTINGS } from './types';

const exam: Exam = {
  id: 'exam-1',
  title: 'Cells',
  created: '2026-10-01T08:00:00.000Z',
  settings: { ...DEFAULT_SETTINGS, length: 1 },
  questions: [
    {
      id: 'q1',
      kind: 'truefalse',
      prompt: 'Ribosomes make proteins.',
      marks: 1,
      answer: 'true',
      guide: [],
      source: { pageId: 'p1', title: 'Cells', topic: 'Ribosome' },
    },
  ],
  engine: 'rules',
};

describe('an exam kept on its pages', () => {
  it('comes back whole from the view it was written to, after a trip through JSON', () => {
    const view = JSON.parse(JSON.stringify({ layout: 'flow', ...storedExam(exam) })) as unknown;
    expect(readStoredExam(view)).toEqual(exam);
  });

  it('is kept under practiceExam, with version 1', () => {
    expect(storedExam(exam)).toEqual({ practiceExam: { version: 1, exam } });
    expect(EXAM_VIEW_KEY).toBe('practiceExam');
  });

  it('refuses a page with none, a newer version, a damaged question, or a paper without its key', () => {
    expect(readStoredExam({ layout: 'flow' })).toBeNull();
    expect(readStoredExam(null)).toBeNull();
    expect(readStoredExam({ practiceExam: { version: 2, exam } })).toBeNull();
    const damaged = { ...exam, questions: [{ ...exam.questions[0], marks: 'one' }] };
    expect(readStoredExam({ practiceExam: { version: 1, exam: damaged } })).toBeNull();
    expect(readStoredExam({ practiceExam: { version: 1, exam: { ...exam, questions: [] } } })).toBeNull();
    expect(readStoredExam({ practiceExam: { version: 1, exam: paperOnly(exam) } })).toBeNull();
  });

  it('is retaken as the same questions and settings under a new id, made now', () => {
    const now = new Date(Date.UTC(2026, 9, 29, 12, 0, 0));
    const fresh = retakeOf(exam, now);
    expect(fresh.id).not.toBe('exam-1');
    expect(fresh.id.startsWith(`exam-${now.getTime().toString(36)}-`)).toBe(true);
    expect(fresh.created).toBe('2026-10-29T12:00:00.000Z');
    expect(fresh.questions).toEqual(exam.questions);
    expect(fresh.settings).toEqual(exam.settings);
    expect(fresh.title).toBe('Cells');
  });
});
