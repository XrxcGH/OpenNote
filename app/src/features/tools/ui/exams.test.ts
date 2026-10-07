// @vitest-environment jsdom
// An exam can be attached to a notebook or a section, and that choice is kept on the device.
import { beforeEach, describe, expect, it } from 'vitest';
import { examsAt, isExamTarget } from '../upcoming';
import type { Exam } from '../upcoming';
import { loadExams, setExams } from './upcomingStores';

const exam = (id: string, target?: Exam['target']): Exam => ({
  id,
  name: id,
  date: '2999-05-01',
  time: '',
  ...(target ? { target } : {}),
});
const notebook = { kind: 'notebook', id: 'nb1', label: 'Biology 101', notebookId: 'nb1' } as const;
const section = { kind: 'section', id: 'sec1', label: 'Biology 101, Lectures', notebookId: 'nb1' } as const;

beforeEach(() => localStorage.clear());

describe('exam targets', () => {
  it('accept a notebook or a section and refuse anything else', () => {
    expect(isExamTarget(notebook)).toBe(true);
    expect(isExamTarget(section)).toBe(true);
    expect(isExamTarget({ ...notebook, kind: 'page' })).toBe(false);
    expect(isExamTarget({ kind: 'notebook', id: 'x' })).toBe(false);
    expect(isExamTarget(null)).toBe(false);
  });

  it('keep the exams of a notebook, a section, and those attached to nothing', () => {
    const all = [exam('free'), exam('book', notebook), exam('sec', section), exam('other', { ...notebook, id: 'nb2' })];
    expect(examsAt(all, { notebookId: 'nb1', sectionId: null }).map((one) => one.id)).toEqual(['free', 'book']);
    expect(examsAt(all, { notebookId: 'nb1', sectionId: 'sec1' }).map((one) => one.id)).toEqual([
      'free',
      'book',
      'sec',
    ]);
    expect(examsAt(all, { notebookId: null, sectionId: null }).map((one) => one.id)).toEqual(['free']);
  });

  it('are saved with the exam and read back', () => {
    setExams([exam('book', notebook), exam('sec', section), exam('free')]);
    const back = loadExams();
    expect(back.map((one) => one.target?.id)).toEqual(['nb1', 'sec1', undefined]);
    expect(back[1].target).toEqual(section);
  });

  it('drop a saved target that is not valid and keep the exam', () => {
    localStorage.setItem(
      'opennote.tools.exams',
      JSON.stringify([{ ...exam('bad'), target: { kind: 'page', id: 3 } }, exam('ok', notebook)]),
    );
    const back = loadExams();
    expect(back).toHaveLength(2);
    expect(back[0].target).toBeUndefined();
    expect(back[1].target).toEqual(notebook);
  });
});
