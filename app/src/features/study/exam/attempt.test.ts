// An exam in progress kept on this device: what is kept comes back as it was, the timer carries on from its
// wall-clock values (paused stays paused, running kept counting), damaged or foreign values are dropped, and only
// the newest few are kept.
import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, dropAttempt, isAttempt, joinKey, loadAttempts, paperOnly, saveAttempt } from './attempt';
import type { Attempt, AttemptStorage } from './attempt';
import { pauseTimer, startTimer, timeLeft } from './timer';
import type { Exam } from './types';
import { DEFAULT_SETTINGS } from './types';

function memory(): AttemptStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 29, 9, 0, 0);

function exam(id: string): Exam {
  return {
    id,
    title: `Exam ${id}`,
    created: '2026-10-29T09:00:00.000Z',
    settings: { ...DEFAULT_SETTINGS, minutes: 15 },
    questions: [
      {
        id: 'q1',
        kind: 'short',
        prompt: 'Name it.',
        marks: 1,
        answer: 'Mitochondria',
        guide: [],
        source: { pageId: 'p', title: 'Cells', topic: 'Organelles' },
      },
    ],
    engine: 'rules',
  };
}

function attempt(id: string, timer = startTimer(15, T0)): Attempt {
  return {
    exam: exam(id),
    answers: {
      q1: {
        text: 'The mitochondria',
        flagged: true,
        ink: [
          [
            [1, 2],
            [3, 4],
          ],
        ],
      },
    },
    timer,
    at: 0,
    notebookId: 'nb',
    saved: T0,
  };
}

describe('kept exam attempts', () => {
  it('brings back the answers, flags, and writing as they were', () => {
    const storage = memory();
    expect(saveAttempt(attempt('a'), storage)).toBe(true);
    const [back] = loadAttempts(storage);
    expect(back?.answers.q1).toEqual({
      text: 'The mitochondria',
      flagged: true,
      ink: [
        [
          [1, 2],
          [3, 4],
        ],
      ],
    });
    expect(back?.notebookId).toBe('nb');
  });

  it('keeps a running timer counting through a restart: 15 minutes started, 5 minutes later 10 are left', () => {
    const storage = memory();
    saveAttempt(attempt('a'), storage);
    const [back] = loadAttempts(storage);
    expect(timeLeft(back!.timer!, T0 + 5 * MINUTE)).toBe(10 * MINUTE);
  });

  it('keeps a paused timer paused through a restart: 3 minutes run, then an hour away, 12 minutes are left', () => {
    const storage = memory();
    saveAttempt(attempt('a', pauseTimer(startTimer(15, T0), T0 + 3 * MINUTE)), storage);
    const [back] = loadAttempts(storage);
    expect(back?.timer?.since).toBeNull();
    expect(timeLeft(back!.timer!, T0 + 63 * MINUTE)).toBe(12 * MINUTE);
  });

  it('lists the newest first and keeps only the newest few', () => {
    const storage = memory();
    for (let n = 0; n < MAX_ATTEMPTS + 2; n += 1) saveAttempt(attempt(`e${n}`), storage);
    saveAttempt(attempt('e3'), storage);
    const ids = loadAttempts(storage).map((one) => one.exam.id);
    expect(ids).toEqual(['e3', 'e6', 'e5', 'e4', 'e2']);
    // The two let go of are gone from storage too, not only from the list.
    expect(storage.data.has('opennote.study.exam.attempt.e0')).toBe(false);
    expect(storage.data.has('opennote.study.exam.attempt.e1')).toBe(false);
  });

  it('drops a submitted or discarded attempt', () => {
    const storage = memory();
    saveAttempt(attempt('a'), storage);
    saveAttempt(attempt('b'), storage);
    dropAttempt('a', storage);
    expect(loadAttempts(storage).map((one) => one.exam.id)).toEqual(['b']);
    expect(storage.data.has('opennote.study.exam.attempt.a')).toBe(false);
  });

  it('skips damaged values and values that are not attempts', () => {
    const storage = memory();
    saveAttempt(attempt('a'), storage);
    storage.setItem('opennote.study.exam.attempts', JSON.stringify(['bad', 'a', 'odd', 7]));
    storage.setItem('opennote.study.exam.attempt.bad', '{not json');
    storage.setItem('opennote.study.exam.attempt.odd', JSON.stringify({ exam: { id: 'odd' } }));
    expect(loadAttempts(storage).map((one) => one.exam.id)).toEqual(['a']);
    expect(isAttempt({ ...attempt('a'), timer: { total: 10, left: 20, since: null, fired: [] } })).toBe(false);
  });

  it('never throws when storage is full or missing', () => {
    const full: AttemptStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(saveAttempt(attempt('a'), full)).toBe(false);
    expect(saveAttempt(attempt('a'), null)).toBe(false);
    expect(loadAttempts(null)).toEqual([]);
  });
});

/** An exam whose key has words in every place one can hide: a choice, a fill-in blank, a math answer with a unit. */
function keyed(id: string): Exam {
  const source = { pageId: 'p', title: 'Physics', topic: 'Motion' };
  return {
    id,
    title: 'Physics',
    created: '2026-10-29T09:00:00.000Z',
    settings: { ...DEFAULT_SETTINGS, minutes: null },
    questions: [
      {
        id: 'q1',
        kind: 'choice',
        prompt: 'Which is a vector?',
        marks: 1,
        answer: 'Velocity',
        choices: ['Speed', 'Velocity', 'Mass'],
        correct: 1,
        guide: ['Has a direction'],
        source,
      },
      {
        id: 'q2',
        kind: 'fill',
        prompt: 'Force is mass times {{acceleration}}.',
        marks: 1,
        answer: 'acceleration',
        guide: [],
        source,
      },
      {
        id: 'q3',
        kind: 'worked',
        prompt: 'A car goes 100 m in 20 s. How fast?',
        marks: 2,
        answer: '5 m/s',
        math: true,
        tolerance: 0.01,
        guide: ['Speed is distance over time', 'Five metres a second'],
        source,
      },
    ],
    engine: 'rules',
  };
}

describe('the answer key is kept apart from an attempt', () => {
  it('stores no answer, guide, right option, or blank word in plain text anywhere in storage', () => {
    const storage = memory();
    saveAttempt({ ...attempt('k'), exam: keyed('k') }, storage);
    const everything = [...storage.data.values()].join(' ');
    for (const secret of [
      '"answer":"Velocity"',
      'Has a direction',
      'acceleration',
      '5 m/s',
      'Five metres',
      '"correct"',
    ])
      expect(everything).not.toContain(secret);
    // The choices themselves are part of the paper, so the person can pick one.
    expect(storage.data.get('opennote.study.exam.attempt.k')).toContain('"Speed","Velocity","Mass"');
  });

  it('gives back a paper only, which still counts the blank and knows the unit is marked', () => {
    const storage = memory();
    saveAttempt({ ...attempt('k'), exam: keyed('k') }, storage);
    const [back] = loadAttempts(storage);
    const [choice, fill, worked] = back!.exam.questions;
    expect(back!.exam.keyApart).toBe(true);
    expect(choice).not.toHaveProperty('correct');
    expect(choice!.answer).toBe('');
    expect(fill!.prompt).toBe('Force is mass times {{?}}.');
    expect(worked!.guide).toEqual([]);
    expect(worked).not.toHaveProperty('tolerance');
    expect(worked!.unit).toBe(true);
  });

  it('joins the key back at hand-in to the exact exam that was started', () => {
    const storage = memory();
    saveAttempt({ ...attempt('k'), exam: keyed('k') }, storage);
    const [back] = loadAttempts(storage);
    expect(joinKey(back!.exam, storage)).toEqual(keyed('k'));
  });

  it('keeps the key when a resumed paper is kept again', () => {
    const storage = memory();
    saveAttempt({ ...attempt('k'), exam: keyed('k') }, storage);
    const [back] = loadAttempts(storage);
    saveAttempt({ ...back!, at: 2 }, storage);
    expect(joinKey(loadAttempts(storage)[0]!.exam, storage)).toEqual(keyed('k'));
  });

  it('leaves out an attempt whose key is gone, and drops the key with its attempt', () => {
    const storage = memory();
    saveAttempt({ ...attempt('k'), exam: keyed('k') }, storage);
    storage.removeItem('opennote.study.exam.key.k');
    expect(loadAttempts(storage)).toEqual([]);
    expect(joinKey(paperOnly(keyed('k')), storage)).toBeNull();
    saveAttempt({ ...attempt('j'), exam: keyed('j') }, storage);
    dropAttempt('j', storage);
    expect(storage.data.has('opennote.study.exam.key.j')).toBe(false);
  });

  it('lets an exam that still has its key through as it is', () => {
    expect(joinKey(keyed('x'), memory())).toEqual(keyed('x'));
  });
});
