// An exam in progress kept on this device: what is kept comes back as it was, the timer carries on from its
// wall-clock values (paused stays paused, running kept counting), damaged or foreign values are dropped, and only
// the newest few are kept.
import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, dropAttempt, isAttempt, loadAttempts, saveAttempt } from './attempt';
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
