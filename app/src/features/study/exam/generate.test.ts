// Practice exam questions by rules, numeric variants of worked problems, and the timer.
import { describe, expect, it } from 'vitest';
import { factsOf, ruleQuestions, seeded } from './generate';
import { makeExam } from './make';
import type { ExamSource } from './sources';
import {
  clockText,
  dueReminders,
  isOver,
  lateBy,
  pauseTimer,
  parseReminders,
  resumeTimer,
  startTimer,
  timeLeft,
} from './timer';
import { QUESTION_KINDS } from './types';
import type { QuestionKind } from './types';
import { numericVariant, readAnswer } from './variant';

const BIOLOGY: ExamSource = {
  pageId: 'bio',
  title: 'Cells',
  text: [
    '# Organelles',
    'Mitochondria: the organelle that releases energy from glucose in respiration.',
    'Ribosome: the small structure where proteins are made from amino acids.',
    'Nucleus: the part of the cell that holds the genetic material and controls it.',
    'Chloroplast: the organelle where photosynthesis makes glucose from light.',
    '',
    '# Transport',
    'Water crosses the membrane by **osmosis** from a dilute solution.',
    '',
    '## Diffusion',
    'Particles spread from where they are crowded to where there are fewer of them, without using energy.',
  ].join('\n'),
};

const PHYSICS: ExamSource = {
  pageId: 'phy',
  title: 'Speed',
  text: [
    '# Average speed',
    'A train travels 120 km in 2.5 hours. Find its average speed.',
    '## Solution',
    '1. Speed is distance divided by time.',
    '2. v = 120 / 2.5 = 48',
    '**Answer:** 48 km/h',
  ].join('\n'),
};

const all = (length: number, kinds: readonly QuestionKind[] = QUESTION_KINDS) => ({
  length,
  difficulty: 'standard' as const,
  kinds,
});

describe('factsOf', () => {
  it('finds definitions, headings, bold words, and worked problems, each with its topic', () => {
    const facts = factsOf([BIOLOGY, PHYSICS]);
    const ribosome = facts.find((fact) => fact.term === 'Ribosome');
    expect(ribosome).toMatchObject({ kind: 'definition', source: { pageId: 'bio', topic: 'Organelles' } });
    expect(facts.find((fact) => fact.kind === 'bold')?.source.topic).toBe('Transport');
    const worked = facts.find((fact) => fact.kind === 'worked');
    expect(worked).toMatchObject({ meaning: '48 km/h', source: { pageId: 'phy', topic: 'Average speed' } });
    expect(facts.some((fact) => /^answer$/i.test(fact.term))).toBe(false);
  });
});

describe('ruleQuestions', () => {
  it('gives the same paper for the same seed, ordered from quick questions to long ones', () => {
    const a = ruleQuestions([BIOLOGY, PHYSICS], all(8), seeded(7));
    const b = ruleQuestions([BIOLOGY, PHYSICS], all(8), seeded(7));
    expect(a).toEqual(b);
    const rank = { truefalse: 0, choice: 1, fill: 2, short: 3, worked: 4 } as const;
    const ranks = a.map((one) => rank[one.kind]);
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
    expect(a).toHaveLength(8);
  });

  it('asks only the kinds chosen and never about one fact twice', () => {
    const questions = ruleQuestions([BIOLOGY], all(20, ['choice']), seeded(3));
    // Four definitions and two headings with paragraphs make choice questions; the bold sentence does not.
    expect(questions.length).toBeGreaterThanOrEqual(4);
    expect(new Set(questions.map((one) => one.prompt)).size).toBe(questions.length);
    for (const one of questions) {
      expect(one.kind).toBe('choice');
      expect(one.choices?.[one.correct ?? -1]).toBe(one.answer);
      expect(new Set(one.choices).size).toBe(one.choices?.length);
    }
  });

  it('makes a fill-in question from a bold word, with a mark for its blank', () => {
    const fill = ruleQuestions([BIOLOGY], all(10, ['fill']), seeded(1)).find((one) =>
      one.prompt.includes('{{osmosis}}'),
    );
    expect(fill).toMatchObject({
      kind: 'fill',
      marks: 1,
      answer: 'osmosis',
    });
  });

  it('writes a true statement or one with a swapped meaning, with the answer to match', () => {
    const questions = ruleQuestions([BIOLOGY], all(4, ['truefalse']), seeded(11));
    expect(questions).toHaveLength(4);
    for (const one of questions) {
      const term = /"([^"]+)"/.exec(one.prompt)?.[1] ?? '';
      const own = BIOLOGY.text.split('\n').find((line) => line.startsWith(`${term}:`)) ?? '';
      const meaning = own.slice(term.length + 2).toLowerCase();
      expect(one.answer).toBe(one.prompt.toLowerCase().includes(meaning) ? 'true' : 'false');
    }
  });

  it('asks a worked problem with new numbers and works out its answer', () => {
    const [worked] = ruleQuestions([PHYSICS], all(1, ['worked']), seeded(5));
    expect(worked?.kind).toBe('worked');
    const km = Number(/travels (\d+(?:\.\d+)?) km/.exec(worked?.prompt ?? '')?.[1]);
    const hours = Number(/in (\d+(?:\.\d+)?) hours/.exec(worked?.prompt ?? '')?.[1]);
    expect(km !== 120 || hours !== 2.5).toBe(true);
    expect(Number.parseFloat(worked?.answer ?? '')).toBeCloseTo(km / hours, 2);
    expect(worked?.answer.endsWith('km/h')).toBe(true);
    expect(worked).toMatchObject({ math: true, marks: 3 });
  });

  it('returns nothing for empty or hostile notes, and never hangs', () => {
    expect(ruleQuestions([], all(10), seeded(1))).toEqual([]);
    const junk: ExamSource = {
      pageId: 'x',
      title: 'X',
      text: `${'#'.repeat(5000)} ${'**'.repeat(4000)}\n${':'.repeat(9000)}`,
    };
    const started = Date.now();
    expect(Array.isArray(ruleQuestions([junk], all(40), seeded(1)))).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('numericVariant', () => {
  it('swaps the givens and keeps the arithmetic', () => {
    const variant = numericVariant('Find 12 * 3.', ['12 * 3 = 36'], '36', () => 0.99);
    // A factor of 1.5 makes 12 into 18 and 3 into 5 (a whole number stays whole), so the answer is 90.
    expect(variant).toMatchObject({ prompt: 'Find 18 * 5.', answer: '90', working: '18 * 5 = 90' });
  });

  it('gives nothing when no step works out the answer', () => {
    expect(numericVariant('Find the speed of 120 km in 2 h.', ['Divide them.'], '60 km/h', () => 0.5)).toBeNull();
    expect(numericVariant('No numbers here.', ['1 + 1 = 2'], '2', () => 0.5)).toBeNull();
  });

  it('reads the number and unit of an answer', () => {
    expect(readAnswer('48 km/h')).toEqual({ value: 48, text: '48', unit: 'km/h' });
    expect(readAnswer('x = 1,250.5 m')).toEqual({ value: 1250.5, text: '1250.5', unit: 'm' });
    expect(readAnswer('none')).toBeNull();
  });
});

describe('makeExam', () => {
  it('uses the model when its questions pass, and the rules for the rest', async () => {
    const reply = JSON.stringify([
      { kind: 'truefalse', prompt: 'True or false: ribosomes make proteins.', answer: true, source: 1 },
      { kind: 'short', prompt: 'What does the nucleus hold?', answer: 'genetic material', marks: 2, source: 1 },
    ]);
    const exam = await makeExam(
      [BIOLOGY],
      { ...all(3), minutes: null, reminders: [] },
      {
        title: 'Cells',
        model: { generate: () => Promise.resolve(reply) },
        seed: 2,
      },
    );
    expect(exam.engine).toBe('model');
    expect(exam.questions).toHaveLength(3);
    expect(exam.questions.map((one) => one.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('falls back to the rules when the model fails or writes nonsense', async () => {
    const failing = await makeExam(
      [BIOLOGY],
      { ...all(5), minutes: null, reminders: [] },
      {
        title: 'Cells',
        model: { generate: () => Promise.reject(new Error('down')) },
        seed: 2,
      },
    );
    expect(failing.engine).toBe('rules');
    expect(failing.questions).toHaveLength(5);
    const nonsense = await makeExam(
      [BIOLOGY],
      { ...all(5), minutes: null, reminders: [] },
      {
        title: 'Cells',
        model: { generate: () => Promise.resolve('Sure! Here are some questions: [{"kind": "essay"}]') },
        seed: 2,
      },
    );
    expect(nonsense.engine).toBe('rules');
  });

  it('keeps settings within bounds', async () => {
    const exam = await makeExam(
      [BIOLOGY],
      { ...all(999), minutes: 9999, reminders: [10, 5000] },
      { title: 'C', seed: 1 },
    );
    expect(exam.settings).toMatchObject({ length: 40, minutes: 300, reminders: [10] });
  });
});

describe('timer', () => {
  it('counts down, pauses, resumes, and gives each reminder once', () => {
    let timer = startTimer(30, 0);
    expect(clockText(timeLeft(timer, 0))).toBe('30:00');
    timer = pauseTimer(timer, 60_000);
    expect(timeLeft(timer, 600_000)).toBe(29 * 60_000);
    timer = resumeTimer(timer, 600_000);
    // 19 minutes later (in all 20 running), 10 minutes are left: the 10 reminder is due, the 5 one is not.
    let step = dueReminders(timer, [10, 5], 600_000 + 19 * 60_000);
    expect(step.due).toEqual([10]);
    step = dueReminders(step.timer, [10, 5], 600_000 + 19 * 60_000 + 1000);
    expect(step.due).toEqual([]);
    expect(isOver(step.timer, 600_000 + 29 * 60_000)).toBe(true);
    expect(clockText(5_400_000)).toBe('1:30:00');
  });

  it('says how late a paper was handed in, from the wall clock', () => {
    expect(lateBy(null, 5_000)).toBeNull();
    // 10 minutes allowed: it starts at 1000, pauses 2 minutes in, and resumes at 300000 with 8 minutes left.
    const timer = resumeTimer(pauseTimer(startTimer(10, 1000), 121_000), 300_000);
    expect(lateBy(timer, 300_000 + 8 * 60_000 - 1)).toBeNull();
    expect(lateBy(timer, 300_000 + 8 * 60_000)).toBe(0);
    // Handed in 3 minutes 20 seconds after zero, as after closing the app with the clock running.
    expect(lateBy(timer, 300_000 + 8 * 60_000 + 200_000)).toBe(200_000);
    expect(lateBy(pauseTimer(timer, 300_000 + 9 * 60_000), 999_999_999)).toBe(0);
  });

  it('reads reminder minutes and drops the rest', () => {
    expect(parseReminders('10, 5; 5 x -3 1.5 2')).toEqual([10, 5, 2]);
    expect(parseReminders('')).toEqual([]);
  });
});
