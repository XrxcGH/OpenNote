// Marking practice exams: math answers by value (numbers, units, tolerance, and expressions), choices, true or
// false, blanks, and what is left to the person; totals, weak topics, and missed questions.
import { describe, expect, it } from 'vitest';
import { NOTES, calculatorUnits } from '../../tools';
import { keyHasUnit } from './basics';
import { cleanMath, compareMath, readsAsMath } from './equivalence';
import { autoMark, isAnswered, markExam, missedQuestions, selfMark, totals, weakTopics } from './mark';
import type { Exam, Question } from './types';
import { DEFAULT_SETTINGS } from './types';

const kit = { dialect: NOTES, units: calculatorUnits };
const source = (topic: string, pageId = 'p1') => ({ pageId, title: 'Physics', topic });

const q = (over: Partial<Question> & Pick<Question, 'id' | 'kind'>): Question => ({
  prompt: 'Question',
  marks: 1,
  answer: '',
  guide: [],
  source: source('Motion'),
  ...over,
});

describe('compareMath', () => {
  it('matches equal numbers and fractions', () => {
    expect(compareMath('0.75', '3/4', kit)).toBe('equal');
    expect(compareMath('1,200', '1200', kit)).toBe('equal');
    expect(compareMath('x = 4', '4', kit)).toBe('equal');
    expect(compareMath('6 ÷ 4', '1.5', kit)).toBe('equal');
  });

  it('tells a different value apart', () => {
    expect(compareMath('0.7', '3/4', kit)).toBe('different');
  });

  it('accepts a rounded value within the tolerance and refuses it without one', () => {
    // 22/7 is 3.142857..., so 3.14 is 0.09 percent off.
    expect(compareMath('3.14', '22/7', kit, 0.01)).toBe('close');
    expect(compareMath('3.14', '22/7', kit, 0)).toBe('different');
  });

  it('compares quantities in any unit of the same kind', () => {
    expect(compareMath('5 km', '5000 m', kit)).toBe('equal');
    expect(compareMath('20 m/s', '72 km/h', kit)).toBe('equal');
    expect(compareMath('5 kg', '5 m', kit)).toBe('different');
  });

  it('notices a missing unit', () => {
    expect(compareMath('48', '48 km/h', kit)).toBe('unit');
  });

  it('matches expressions that are the same for every x', () => {
    expect(compareMath('2(x + 1)', '2x + 2', kit)).toBe('equal');
    expect(compareMath('x^2 - 1', '(x - 1)(x + 1)', kit)).toBe('equal');
    expect(compareMath('x^2 + 1', '(x + 1)^2', kit)).toBe('different');
  });

  it('calls words and hostile text unreadable instead of throwing', () => {
    expect(compareMath('photosynthesis', '3', kit)).toBe('unreadable');
    expect(compareMath('(((((((((', '3', kit)).toBe('unreadable');
    expect(compareMath('1'.repeat(5000), '3', kit)).toBe('unreadable');
    expect(compareMath('('.repeat(3000) + '1' + ')'.repeat(3000), '1', kit)).toBe('unreadable');
    expect(compareMath('9^9^9^9', '3', kit)).toBe('different');
  });

  it('cleans typed signs', () => {
    expect(cleanMath('x² − 2 × 3 =')).toBe('x^2 - 2 * 3');
    expect(readsAsMath('9.8 m/s^2', kit)).toBe(true);
    expect(readsAsMath('mitochondria', kit)).toBe(false);
  });

  it('reads the root sign with the number, name, or bracket after it', () => {
    expect(cleanMath('√16')).toBe('sqrt(16)');
    expect(cleanMath('√ (x+1)')).toBe('sqrt(x+1)');
    // √16 is 4, √(x + 1) at x = 3 is 2, and 2√9 is 6: values worked by hand, not by the engine.
    expect(compareMath('√16', '4', kit)).toBe('equal');
    expect(compareMath('√(x+1)', 'sqrt(x + 1)', kit)).toBe('equal');
    expect(compareMath('√(x+1)', 'x + 1', kit)).toBe('different');
    expect(compareMath('2√9', '6', kit)).toBe('equal');
    expect(compareMath('√2.25', '1.5', kit)).toBe('equal');
  });

  it('knows when a key has a unit, so the field can ask for it', () => {
    expect(keyHasUnit('5 m')).toBe(true);
    expect(keyHasUnit('9.8 m/s^2')).toBe(true);
    expect(keyHasUnit('20 °C')).toBe(true);
    expect(keyHasUnit('50 km/h')).toBe(true);
    expect(keyHasUnit('4')).toBe(false);
    expect(keyHasUnit('2x + 1')).toBe(false);
    expect(keyHasUnit('2(x + 1)')).toBe(false);
    expect(keyHasUnit('Mitochondria')).toBe(false);
  });
});

describe('autoMark', () => {
  const choice = q({ id: 'c', kind: 'choice', choices: ['a', 'b', 'c'], correct: 2, answer: 'c' });
  const tf = q({ id: 't', kind: 'truefalse', answer: 'false' });
  const fill = q({ id: 'f', kind: 'fill', prompt: 'The {{mitochondria}} makes {{ATP}}.', marks: 2, answer: '' });
  const num = q({ id: 'n', kind: 'short', marks: 2, answer: '48 km/h', math: true, tolerance: 0.01 });
  const worked = q({ id: 'w', kind: 'worked', marks: 4, answer: '48 km/h', math: true, tolerance: 0.01 });
  const words = q({ id: 's', kind: 'short', marks: 3, answer: 'Movement of water across a membrane' });

  it('marks choices and true or false by the option picked', () => {
    expect(autoMark(choice, { picked: 2 }, kit)?.got).toBe(1);
    expect(autoMark(choice, { picked: 0 }, kit)?.got).toBe(0);
    expect(autoMark(tf, { picked: 1 }, kit)?.status).toBe('right');
    expect(autoMark(tf, { picked: 0 }, kit)?.status).toBe('wrong');
    expect(autoMark(tf, {}, kit)?.note).toBe('blank');
  });

  it('gives a mark for each right blank, leniently', () => {
    expect(autoMark(fill, { blanks: ['Mitochondria', 'atp'] }, kit)?.got).toBe(2);
    expect(autoMark(fill, { blanks: ['nucleus', 'ATP'] }, kit)).toMatchObject({ got: 1, status: 'partial' });
  });

  it('marks math by value, takes a mark off for a missing unit, and passes a wrong worked answer to the person', () => {
    expect(autoMark(num, { text: '13.33 m/s' }, kit)).toMatchObject({ got: 2, note: 'close' });
    expect(autoMark(num, { text: '48' }, kit)).toMatchObject({ got: 1, note: 'unit' });
    expect(autoMark(num, { text: '50 km/h' }, kit)?.got).toBe(0);
    expect(autoMark(worked, { text: '48 km/h' }, kit)?.got).toBe(4);
    expect(autoMark(worked, { text: '40 km/h', working: '120 / 3' }, kit)).toBeNull();
  });

  it('leaves answers in words to the person, and marks a blank one zero', () => {
    expect(autoMark(words, { text: 'water moves' }, kit)).toBeNull();
    expect(autoMark(words, { text: '  ' }, kit)).toMatchObject({ got: 0, note: 'blank' });
    expect(isAnswered(words, { ink: [[[1, 2]]] })).toBe(true);
  });

  it('keeps a self mark to whole marks within the question', () => {
    expect(selfMark(words, 7).got).toBe(3);
    expect(selfMark(words, -2).got).toBe(0);
    expect(selfMark(words, 1.6)).toMatchObject({ got: 2, status: 'partial' });
    expect(selfMark(words, Number.NaN).got).toBe(0);
  });
});

describe('totals and weak topics', () => {
  const exam: Exam = {
    id: 'e',
    title: 'Physics',
    created: '2026-10-29T00:00:00.000Z',
    settings: DEFAULT_SETTINGS,
    engine: 'rules',
    questions: [
      q({ id: 'a', kind: 'truefalse', answer: 'true', source: source('Motion') }),
      q({ id: 'b', kind: 'truefalse', answer: 'true', source: source('Motion') }),
      q({ id: 'c', kind: 'truefalse', answer: 'true', source: source('Forces', 'p2') }),
      q({ id: 'd', kind: 'short', marks: 3, answer: 'words', source: source('Energy', 'p3') }),
    ],
  };

  it('adds up marked questions and counts the unmarked', () => {
    const marks = markExam(exam, { a: { picked: 0 }, b: { picked: 1 }, c: { picked: 0 }, d: { text: 'x' } }, kit);
    expect(totals(exam, marks)).toEqual({ got: 2, of: 6, percent: 33, unmarked: 1 });
    // Motion has 1 of 2 (50 percent): weak. Forces has 1 of 1: not weak. Energy is not marked yet.
    expect(weakTopics(exam, marks)).toEqual([{ topic: 'Motion', pageId: 'p1', title: 'Physics', got: 1, of: 2 }]);
    expect(missedQuestions(exam, marks).map((one) => one.id)).toEqual(['b']);
    const all = { ...marks, d: selfMark(exam.questions[3] as Question, 0) };
    expect(weakTopics(exam, all).map((one) => one.topic)).toEqual(['Energy', 'Motion']);
  });
});
