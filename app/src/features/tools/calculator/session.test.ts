import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY,
  clearHistory,
  lastAnswer,
  memoryAdd,
  memoryClear,
  memoryStore,
  newSession,
  restoreSession,
  setAngleMode,
  submit,
} from './session';

function run(session = newSession(), ...inputs: string[]) {
  return inputs.reduce((s, input) => submit(s, input).session, session);
}

describe('the calculator session', () => {
  it('keeps answers in a history and reads the last one as ans', () => {
    const session = run(newSession(), '2 + 3', 'ans * 4');
    expect(session.history.map((e) => [e.expression, e.value])).toEqual([
      ['2 + 3', 5],
      ['ans * 4', 20],
    ]);
    expect(lastAnswer(session)).toBe(20);
    expect(lastAnswer(newSession())).toBe(0);
  });

  it('continues from the last answer when an entry starts with an operator', () => {
    const session = run(newSession(), '6 * 7', '/ 2', '^2=', '×2');
    expect(session.history.map((e) => [e.expression, e.value])).toEqual([
      ['6 * 7', 42],
      ['ans/ 2', 21],
      ['ans^2', 441],
      ['ans×2', 882],
    ]);
  });

  it('leaves the session alone when the input has an error', () => {
    const start = run(newSession(), '1 + 1');
    const { session, result } = submit(start, '1 / 0');
    expect(result).toMatchObject({ ok: false, error: { code: 'divide-by-zero' } });
    expect(session).toBe(start);
  });

  it('remembers the angle mode each answer used', () => {
    const degrees = run(newSession(), 'sin(30)');
    const radians = run(setAngleMode(degrees, 'rad'), 'sin(pi/6)');
    expect(radians.history.map((e) => [e.value, e.angle])).toEqual([
      [0.5, 'deg'],
      [0.5, 'rad'],
    ]);
    expect(clearHistory(radians).history).toEqual([]);
  });

  it('caps the history', () => {
    let session = newSession();
    for (let i = 0; i < MAX_HISTORY + 5; i += 1) session = run(session, String(i));
    expect(session.history).toHaveLength(MAX_HISTORY);
    expect(session.history[0].value).toBe(5);
    expect(session.nextId).toBe(MAX_HISTORY + 6);
  });
});

describe('memory slots', () => {
  it('stores, recalls in expressions, adds, and clears', () => {
    let session = memoryStore(newSession(), 1, 10);
    session = memoryStore(session, 2, 0.5);
    expect(submit(session, 'm1 * m2 + m3').result).toEqual({ ok: true, value: 5 });
    session = memoryAdd(session, 1, 2.5);
    session = memoryAdd(session, 3, -4);
    expect(session.memory.slice(0, 3)).toEqual([12.5, 0.5, -4]);
    session = memoryAdd(session, 1, 0.1);
    session = memoryAdd(session, 1, 0.2);
    expect(session.memory[0]).toBe(12.8);
    expect(memoryClear(session, 2).memory[1]).toBeNull();
    expect(memoryClear(session, 2).memory[0]).toBe(12.8);
    expect(memoryClear(session).memory.every((v) => v === null)).toBe(true);
  });

  it('ignores a slot that does not exist', () => {
    const session = newSession();
    expect(memoryStore(session, 0, 1)).toBe(session);
    expect(memoryStore(session, 10, 1)).toBe(session);
    expect(memoryAdd(session, 1.5, 1)).toBe(session);
    expect(memoryClear(session, 12)).toBe(session);
  });
});

describe('saving a session', () => {
  it('round-trips through JSON', () => {
    let session = setAngleMode(newSession(), 'rad');
    session = memoryStore(run(session, '2^10', 'ans - 24'), 4, 9);
    expect(restoreSession(JSON.parse(JSON.stringify(session)))).toEqual(session);
  });

  it('survives damaged data', () => {
    expect(restoreSession(null)).toEqual(newSession());
    expect(restoreSession('x')).toEqual(newSession());
    const restored = restoreSession({
      angle: 'furlongs',
      history: [{ id: 3, expression: '1+1', value: 2, angle: 'rad' }, { id: 'x' }, null],
      memory: [1, 'two', Number.NaN],
    });
    expect(restored.angle).toBe('deg');
    expect(restored.history).toEqual([{ id: 3, expression: '1+1', value: 2, angle: 'rad' }]);
    expect(restored.memory.slice(0, 3)).toEqual([1, null, null]);
    expect(restored.memory).toHaveLength(9);
    expect(restored.nextId).toBe(4);
  });
});

describe('long input', () => {
  it('drops a long run of equals signs in linear time', () => {
    const started = performance.now();
    const { result } = submit(newSession(), `${'='.repeat(60000)}x`);
    expect(result.ok ? null : result.error.code).toBe('too-long');
    expect(performance.now() - started).toBeLessThan(1000);
    expect(submit(newSession(), '6*7 ===').result).toMatchObject({ ok: true, value: 42 });
  });
});
