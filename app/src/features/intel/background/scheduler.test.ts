import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduler, restAfter } from './scheduler';
import type { JobSpec, Scheduler, Surroundings } from './scheduler';

let idle = true;
let plugged = true;
let scheduler: Scheduler;
const surroundings: Surroundings = { idle: () => idle, pluggedIn: () => plugged, now: () => Date.now() };

function job(id: string, ran: string[], extra: Partial<JobSpec> = {}): JobSpec {
  return {
    id,
    kind: 'imageText',
    label: id,
    run: async () => {
      ran.push(id);
    },
    ...extra,
  };
}

const statuses = () => scheduler.state.get().jobs.map((one) => `${one.id}:${one.status}`);

beforeEach(() => {
  vi.useFakeTimers();
  idle = true;
  plugged = true;
  scheduler = createScheduler(surroundings, { cpuPercent: 100 });
});
afterEach(() => {
  scheduler.dispose();
  vi.useRealTimers();
});

describe('the rest between jobs', () => {
  it('keeps the share of time at the cap', () => {
    expect(restAfter(100, 100)).toBe(0);
    expect(restAfter(100, 50)).toBe(100);
    expect(restAfter(100, 25)).toBe(300);
  });
});

describe('running work', () => {
  it('runs jobs one at a time in the order they came', async () => {
    const ran: string[] = [];
    scheduler.enqueue(job('a', ran));
    scheduler.enqueue(job('b', ran));
    await vi.advanceTimersByTimeAsync(10);
    expect(ran).toEqual(['a', 'b']);
    expect(statuses()).toEqual(['a:done', 'b:done']);
  });

  it('ignores a job with an ID it already has', () => {
    const ran: string[] = [];
    expect(scheduler.enqueue(job('a', ran))).toBe(true);
    expect(scheduler.enqueue(job('a', ran))).toBe(false);
  });

  it('keeps a failed job so it can be tried again', async () => {
    let attempts = 0;
    scheduler.enqueue({
      ...job('a', []),
      run: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('no');
      },
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(statuses()).toEqual(['a:failed']);
    scheduler.retry('a');
    await vi.advanceTimersByTimeAsync(10);
    expect(statuses()).toEqual(['a:done']);
  });

  it('rests after a job when the cap is low', async () => {
    scheduler.setPrefs({ cpuPercent: 50 });
    const ran: string[] = [];
    scheduler.enqueue({
      ...job('a', ran),
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        ran.push('a');
      },
    });
    scheduler.enqueue(job('b', ran));
    await vi.advanceTimersByTimeAsync(150);
    expect(ran).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(100);
    expect(ran).toEqual(['a', 'b']);
  });
});

describe('the person’s limits', () => {
  it('holds work while paused and goes on when resumed', async () => {
    const ran: string[] = [];
    scheduler.setPrefs({ paused: true });
    scheduler.enqueue(job('a', ran));
    await vi.advanceTimersByTimeAsync(10);
    expect(ran).toEqual([]);
    expect(scheduler.state.get().waiting).toBe('paused');
    scheduler.setPrefs({ paused: false });
    await vi.advanceTimersByTimeAsync(10);
    expect(ran).toEqual(['a']);
    expect(scheduler.state.get().waiting).toBeNull();
  });

  it('waits for the computer to be idle, looking again every few seconds', async () => {
    const ran: string[] = [];
    idle = false;
    scheduler.setPrefs({ onlyWhenIdle: true });
    scheduler.enqueue(job('a', ran));
    await vi.advanceTimersByTimeAsync(6000);
    expect(ran).toEqual([]);
    expect(scheduler.state.get().waiting).toBe('idle');
    idle = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(ran).toEqual(['a']);
  });

  it('waits for the power cord', async () => {
    const ran: string[] = [];
    plugged = false;
    scheduler.setPrefs({ onlyWhenPluggedIn: true });
    scheduler.enqueue(job('a', ran));
    await vi.advanceTimersByTimeAsync(6000);
    expect(scheduler.state.get().waiting).toBe('power');
    plugged = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(ran).toEqual(['a']);
  });

  it('leaves out automatic jobs when work runs only on request, and keeps the ones the person asked for', async () => {
    const ran: string[] = [];
    scheduler.setPrefs({ onlyOnRequest: true });
    expect(scheduler.enqueue(job('auto', ran, { automatic: true }))).toBe(false);
    expect(scheduler.enqueue(job('asked', ran))).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(ran).toEqual(['asked']);
  });

  it('drops waiting automatic jobs when the person turns on-request mode on', () => {
    scheduler.setPrefs({ paused: true });
    scheduler.enqueue(job('auto', [], { automatic: true }));
    scheduler.enqueue(job('asked', []));
    scheduler.setPrefs({ onlyOnRequest: true });
    expect(statuses()).toEqual(['asked:waiting']);
  });
});

describe('canceling', () => {
  it('removes a waiting job and aborts a running one', async () => {
    let aborted = false;
    scheduler.enqueue({
      ...job('a', []),
      run: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('stopped'));
          });
        }),
    });
    scheduler.enqueue(job('b', []));
    await vi.advanceTimersByTimeAsync(1);
    expect(statuses()).toEqual(['a:running', 'b:waiting']);
    scheduler.cancel('b');
    scheduler.cancel('a');
    await vi.advanceTimersByTimeAsync(1);
    expect(aborted).toBe(true);
    expect(statuses()).toEqual([]);
  });

  it('clears finished jobs', async () => {
    scheduler.enqueue(job('a', []));
    await vi.advanceTimersByTimeAsync(10);
    scheduler.clearFinished();
    expect(statuses()).toEqual([]);
  });
});
