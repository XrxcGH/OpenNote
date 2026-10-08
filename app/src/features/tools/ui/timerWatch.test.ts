// @vitest-environment jsdom
// The watcher that notices a finished timer: with the Timers window closed, it tells a screen reader once and shows a
// Windows notification only for a timer that asked for one. The title bar chip reads the timer that ends first.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTimers, restoreTimerSet } from '../timers';
import { chipReading } from './timerSet';
import { watchTimers } from './timerWatch';

const shown: { title: string; body?: string }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-02T09:00:00Z'));
  localStorage.clear();
  shown.length = 0;
  localStorage.setItem('opennote.tools.reminders', JSON.stringify({ on: true }));
  vi.stubGlobal(
    'Notification',
    Object.assign(
      function Notification(title: string, options?: { body?: string }) {
        shown.push({ title, body: options?.body });
      },
      { permission: 'granted' },
    ),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function start(notify: boolean) {
  const timers = createTimers(() => Date.now());
  const id = timers.add({ kind: 'countdown', durationMs: 5000 }, 'Tea');
  if (notify) timers.setNotify(id, true);
  timers.act(id, 'start');
  return { timers, id };
}

describe('the timer watcher', () => {
  it('shows a notification when a timer that asked for one finishes, with no window open', () => {
    const { timers } = start(true);
    const stop = watchTimers(timers);
    expect(shown).toHaveLength(0);
    vi.advanceTimersByTime(5200);
    expect(shown).toEqual([{ title: 'Timer finished', body: 'Tea' }]);
    stop();
  });

  it('shows nothing for a timer that did not ask for a notification', () => {
    const { timers } = start(false);
    const stop = watchTimers(timers);
    vi.advanceTimersByTime(6000);
    expect(shown).toHaveLength(0);
    stop();
  });

  it('tells each finish once, even to a second window watching the same device', () => {
    const { timers } = start(true);
    const second = createTimers(() => Date.now(), timers.snapshot());
    const stopFirst = watchTimers(timers);
    const stopSecond = watchTimers(second);
    vi.advanceTimersByTime(6000);
    expect(shown).toHaveLength(1);
    stopFirst();
    stopSecond();
  });

  it('does not tell about a timer that had already finished when the app started', () => {
    const { timers } = start(true);
    vi.advanceTimersByTime(8000);
    const stop = watchTimers(timers);
    vi.advanceTimersByTime(1000);
    expect(shown).toHaveLength(0);
    stop();
  });

  it('tells about a timer that ends while the computer sleeps, as soon as it wakes', () => {
    const { timers } = start(true);
    const stop = watchTimers(timers);
    // The clock jumps an hour ahead without the timeouts running, as when the lid is closed.
    vi.setSystemTime(Date.now() + 3_600_000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(shown).toHaveLength(1);
    stop();
  });
});

describe('a timer that asks for a notification', () => {
  it('keeps the choice when it is saved and restored', () => {
    const { timers } = start(true);
    const back = restoreTimerSet(JSON.parse(JSON.stringify(timers.snapshot())));
    expect(back.timers[0].notify).toBe(true);
    expect(createTimers(() => Date.now(), back).views()[0].notify).toBe(true);
  });

  it('can stop asking', () => {
    const { timers, id } = start(true);
    timers.setNotify(id, false);
    expect(timers.views()[0].notify).toBe(false);
  });
});

describe('the title bar chip', () => {
  it('shows nothing when no timer is running', () => {
    expect(chipReading(createTimers(() => Date.now()).views())).toBeNull();
  });

  it('shows the timer that ends first and how many run', () => {
    const timers = createTimers(() => Date.now());
    const long = timers.add({ kind: 'countdown', durationMs: 600_000 }, 'Essay');
    const short = timers.add({ kind: 'countdown', durationMs: 90_000 }, 'Tea');
    const idle = timers.add({ kind: 'stopwatch' }, 'Idle');
    timers.act(long, 'start');
    timers.act(short, 'start');
    expect(idle).toBeTruthy();
    expect(chipReading(timers.views())).toEqual({ label: 'Tea', text: '1:30', count: 2 });
  });

  it('counts up for a stopwatch when it is the only one running', () => {
    const timers = createTimers(() => Date.now());
    const watch = timers.add({ kind: 'stopwatch' }, 'Lap timer');
    timers.act(watch, 'start');
    vi.advanceTimersByTime(65_000);
    expect(chipReading(timers.views())).toEqual({ label: 'Lap timer', text: '1:05', count: 1 });
  });
});
