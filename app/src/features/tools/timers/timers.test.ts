import { describe, expect, it, vi } from 'vitest';
import { monotonic } from './clock';
import { createTimers } from './controller';
import { focusPosition, focusTotalMs } from './focus';
import { actOnTimer, addTimer, EMPTY_TIMER_SET, nextWake, restoreTimerSet, viewTimers } from './set';
import { configProblem, createTimer, viewTimer, applyAction } from './timer';
import type { FocusConfig, TimerConfig } from './types';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const T0 = 1_700_000_000_000;

function fakeClock(start = T0) {
  let now = start;
  const clock = () => now;
  clock.advance = (ms: number) => void (now += ms);
  return clock;
}

describe('a countdown', () => {
  const config: TimerConfig = { kind: 'countdown', durationMs: 10 * MINUTE };

  it('counts down while running and says when it ends', () => {
    let timer = applyAction(createTimer('a', config), 'start', T0);
    const view = viewTimer(timer, T0 + 4 * MINUTE);
    expect(view.status).toBe('running');
    expect(view.leftMs).toBe(6 * MINUTE);
    expect(view.endsAt).toBe(T0 + 10 * MINUTE);
    expect(view.nextChangeAt).toBe(T0 + 10 * MINUTE);
    timer = applyAction(timer, 'pause', T0 + 4 * MINUTE);
    expect(viewTimer(timer, T0 + 99 * MINUTE)).toMatchObject({ status: 'paused', leftMs: 6 * MINUTE, endsAt: null });
  });

  it('resumes where it paused, so paused time never counts', () => {
    let timer = applyAction(createTimer('a', config), 'start', T0);
    timer = applyAction(timer, 'pause', T0 + 3 * MINUTE);
    timer = applyAction(timer, 'resume', T0 + 20 * MINUTE);
    const view = viewTimer(timer, T0 + 22 * MINUTE);
    expect(view.leftMs).toBe(5 * MINUTE);
    expect(view.endsAt).toBe(T0 + 27 * MINUTE);
  });

  it('finishes even if the computer slept past the end, and remembers when', () => {
    const timer = applyAction(createTimer('a', config), 'start', T0);
    const view = viewTimer(timer, T0 + 3 * 60 * MINUTE);
    expect(view).toMatchObject({ status: 'done', leftMs: 0, endsAt: null, finishedAt: T0 + 10 * MINUTE });
    const paused = applyAction(timer, 'pause', T0 + 3 * 60 * MINUTE);
    expect(paused).toMatchObject({ status: 'done', elapsedMs: 10 * MINUTE, finishedAt: T0 + 10 * MINUTE });
  });

  it('resets to idle and ignores actions that do not fit', () => {
    const idle = createTimer('a', config);
    expect(applyAction(idle, 'pause', T0)).toEqual(idle);
    expect(applyAction(idle, 'resume', T0)).toEqual(idle);
    expect(applyAction(idle, 'lap', T0)).toEqual(idle);
    const running = applyAction(idle, 'start', T0);
    expect(applyAction(running, 'start', T0 + SECOND)).toBe(running);
    expect(applyAction(running, 'reset', T0 + SECOND)).toEqual(idle);
    expect(viewTimer(idle, T0)).toMatchObject({ status: 'idle', leftMs: 10 * MINUTE, endsAt: null });
  });

  it('never counts backward if the clock does', () => {
    const timer = applyAction(createTimer('a', config), 'start', T0);
    expect(viewTimer(timer, T0 - 5 * MINUTE).elapsedMs).toBe(0);
    const clock = monotonic(vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(50).mockReturnValue(120));
    expect([clock(), clock(), clock()]).toEqual([100, 100, 120]);
  });
});

describe('a stopwatch', () => {
  it('counts up, records laps, and never ends', () => {
    let timer = applyAction(createTimer('s', { kind: 'stopwatch' }), 'start', T0);
    timer = applyAction(timer, 'lap', T0 + 5 * SECOND);
    timer = applyAction(timer, 'pause', T0 + 8 * SECOND);
    timer = applyAction(timer, 'resume', T0 + 60 * SECOND);
    timer = applyAction(timer, 'lap', T0 + 62 * SECOND);
    const view = viewTimer(timer, T0 + 10_000 * MINUTE);
    expect(view.laps).toEqual([5 * SECOND, 10 * SECOND]);
    expect(view).toMatchObject({ status: 'running', leftMs: null, endsAt: null, nextChangeAt: null });
    expect(view.elapsedMs).toBe(8 * SECOND + (10_000 * MINUTE - 60 * SECOND));
    expect(applyAction(timer, 'reset', T0).laps).toEqual([]);
  });
});

describe('a focus timer', () => {
  const config: FocusConfig = { kind: 'focus', workMs: 25 * MINUTE, breakMs: 5 * MINUTE, cycles: 3 };

  it('alternates work and break and ends after the last work period', () => {
    expect(focusTotalMs(config)).toBe(85 * MINUTE);
    expect(focusPosition(config, 0)).toMatchObject({ phase: 'work', phaseIndex: 0, cycle: 1 });
    expect(focusPosition(config, 25 * MINUTE)).toMatchObject({
      phase: 'break',
      phaseIndex: 1,
      phaseLeftMs: 5 * MINUTE,
    });
    expect(focusPosition(config, 30 * MINUTE)).toMatchObject({ phase: 'work', phaseIndex: 2, cycle: 2 });
    expect(focusPosition(config, 84 * MINUTE)).toMatchObject({ phase: 'work', phaseIndex: 4, cycle: 3 });
    expect(focusPosition(config, 85 * MINUTE)).toBeNull();
  });

  it('reports the phase, when it ends, and when the whole session ends', () => {
    const timer = applyAction(createTimer('f', config), 'start', T0);
    const view = viewTimer(timer, T0 + 27 * MINUTE);
    expect(view.focus).toMatchObject({ phase: 'break', cycle: 1, cycles: 3, phaseLeftMs: 3 * MINUTE });
    expect(view.focus?.phaseEndsAt).toBe(T0 + 30 * MINUTE);
    expect(view.nextChangeAt).toBe(T0 + 30 * MINUTE);
    expect(view.endsAt).toBe(T0 + 85 * MINUTE);
    expect(view.leftMs).toBe(58 * MINUTE);
  });

  it('skips the phases that passed during sleep', () => {
    const timer = applyAction(createTimer('f', config), 'start', T0);
    expect(viewTimer(timer, T0 + 62 * MINUTE).focus).toMatchObject({ phase: 'work', cycle: 3, phaseIndex: 4 });
    expect(viewTimer(timer, T0 + 600 * MINUTE)).toMatchObject({ status: 'done', focus: null });
  });

  it('supports a single cycle with no break', () => {
    const one: FocusConfig = { ...config, cycles: 1 };
    expect(focusTotalMs(one)).toBe(25 * MINUTE);
    expect(focusPosition(one, 25 * MINUTE)).toBeNull();
  });
});

describe('timer configuration', () => {
  it('names the first problem', () => {
    expect(configProblem({ kind: 'countdown', durationMs: 0 })).toBe('duration');
    expect(configProblem({ kind: 'countdown', durationMs: Number.NaN })).toBe('duration');
    expect(configProblem({ kind: 'focus', workMs: 0, breakMs: 1, cycles: 1 })).toBe('work');
    expect(configProblem({ kind: 'focus', workMs: 1, breakMs: -1, cycles: 1 })).toBe('break');
    expect(configProblem({ kind: 'focus', workMs: 1, breakMs: 1, cycles: 1.5 })).toBe('cycles');
    expect(configProblem({ kind: 'focus', workMs: 1, breakMs: 1, cycles: 100 })).toBe('cycles');
    expect(configProblem({ kind: 'stopwatch' })).toBeNull();
    expect(() => createTimer('x', { kind: 'countdown', durationMs: -1 })).toThrow(RangeError);
  });

  it('rounds durations to whole milliseconds and trims labels', () => {
    const timer = createTimer('x', { kind: 'countdown', durationMs: 1000.4 }, '  Read chapter 3  ');
    expect(timer.config).toEqual({ kind: 'countdown', durationMs: 1000 });
    expect(timer.label).toBe('Read chapter 3');
  });
});

describe('several timers', () => {
  it('runs them independently and finds the next wake-up', () => {
    let { set } = addTimer(EMPTY_TIMER_SET, { kind: 'countdown', durationMs: 10 * MINUTE }, 'Tea');
    const second = addTimer(set, { kind: 'countdown', durationMs: 3 * MINUTE }, 'Eggs');
    set = second.set;
    expect(set.timers.map((t) => t.id)).toEqual(['t1', 't2']);
    set = actOnTimer(set, 't1', 'start', T0);
    set = actOnTimer(set, second.id, 'start', T0 + MINUTE);
    expect(nextWake(set, T0 + 2 * MINUTE)).toBe(T0 + 4 * MINUTE);
    const views = viewTimers(set, T0 + 5 * MINUTE);
    expect(views.map((v) => [v.label, v.status])).toEqual([
      ['Tea', 'running'],
      ['Eggs', 'done'],
    ]);
    expect(nextWake(EMPTY_TIMER_SET, T0)).toBeNull();
  });

  it('survives a save and restore, including a restart mid-run', () => {
    const clock = fakeClock();
    const timers = createTimers(clock);
    const id = timers.add({ kind: 'countdown', durationMs: 30 * MINUTE }, 'Essay');
    timers.act(id, 'start');
    clock.advance(10 * MINUTE);
    const saved = JSON.parse(JSON.stringify(timers.snapshot()));
    clock.advance(5 * MINUTE);
    const restored = createTimers(clock, restoreTimerSet(saved));
    expect(restored.views()[0]).toMatchObject({ label: 'Essay', leftMs: 15 * MINUTE, status: 'running' });
    expect(restored.views()[0].endsAt).toBe(T0 + 30 * MINUTE);
  });

  it('restores damaged data without throwing', () => {
    expect(restoreTimerSet(null)).toEqual(EMPTY_TIMER_SET);
    expect(restoreTimerSet({ timers: 5 })).toEqual(EMPTY_TIMER_SET);
    const set = restoreTimerSet({
      nextId: 1,
      timers: [
        { id: 't4', config: { kind: 'countdown', durationMs: 60000 }, status: 'running', elapsedMs: 'x' },
        { id: 't4', config: { kind: 'stopwatch' } },
        { id: 't5', config: { kind: 'countdown', durationMs: -5 } },
        { id: 't6', config: { kind: 'bogus' } },
        'nonsense',
      ],
    });
    expect(set.timers).toHaveLength(1);
    expect(set.timers[0]).toMatchObject({ id: 't4', status: 'paused', elapsedMs: 0, runningSince: null });
    expect(set.nextId).toBe(5);
  });
});

describe('the live wrapper', () => {
  it('tells listeners about changes and reads the injected clock', () => {
    const clock = fakeClock();
    const timers = createTimers(clock);
    const listener = vi.fn();
    const stop = timers.subscribe(listener);
    const id = timers.add({ kind: 'focus', workMs: 25 * MINUTE, breakMs: 5 * MINUTE, cycles: 2 });
    timers.act(id, 'start');
    clock.advance(26 * MINUTE);
    expect(timers.views()[0].focus?.phase).toBe('break');
    expect(timers.nextWake()).toBe(T0 + 30 * MINUTE);
    timers.pauseAll();
    expect(timers.views()[0].status).toBe('paused');
    timers.rename(id, 'Study');
    timers.remove(id);
    expect(listener).toHaveBeenCalledTimes(5);
    stop();
    timers.add({ kind: 'stopwatch' });
    expect(listener).toHaveBeenCalledTimes(5);
  });
});
