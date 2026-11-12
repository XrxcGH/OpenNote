// The run host with stand-in workers and fake timers (DESIGN 4.2). It covers:
// - one fresh worker per run, and a warm worker per active runtime, so the next run starts without loading;
// - release after two minutes idle, and at most two runs at once;
// - the time and load limits, Stop, and the output cap. A compile step has its own limit.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeId } from '../contracts/run';
import { IDLE_RELEASE_MS, RunHost } from './host';
import { statusLine } from './summary';
import type { RunOrder, WorkerLike } from './host';
import type { HostMessage } from './protocol';
import { RUN_LIMITS } from './protocol';

/** A stand-in worker: records what the page sent, and lets the test answer as the worker would. */
class FakeWorker implements WorkerLike {
  sent: HostMessage[] = [];
  terminated = false;
  private onMessage: (data: unknown) => void = () => undefined;
  private onError: (message: string) => void = () => undefined;

  constructor(readonly runtime: RuntimeId) {}

  postMessage(message: HostMessage): void {
    this.sent.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  listen(onMessage: (data: unknown) => void, onError: (message: string) => void): void {
    this.onMessage = onMessage;
    this.onError = onError;
  }
  say(data: unknown): void {
    if (!this.terminated) this.onMessage(data);
  }
  crash(message: string): void {
    this.onError(message);
  }
  load(): void {
    this.say({ kind: 'loading', percent: 0 });
    this.say({ kind: 'loading', percent: 100 });
  }
}

const order: RunOrder = {
  runtime: 'python-quick',
  files: [{ path: 'main.py', text: 'print(1)' }],
  main: 'main.py',
  args: [],
  stdin: { mode: 'prefilled', text: '' },
  limits: RUN_LIMITS,
  seed: 1,
};

let workers: FakeWorker[];
let idle: (() => void)[];

function host(options: { maxRuns?: number; compileMs?: number } = {}) {
  return new RunHost({
    createWorker: (runtime) => {
      const worker = new FakeWorker(runtime);
      workers.push(worker);
      return worker;
    },
    whenIdle: (task) => idle.push(task),
    ...options,
  });
}

const runIdle = () => idle.splice(0).forEach((task) => task());

beforeEach(() => {
  vi.useFakeTimers();
  workers = [];
  idle = [];
});
afterEach(() => vi.useRealTimers());

describe('warm pool', () => {
  it('starts the second run without a load message', async () => {
    const runs = host();
    const loads: number[][] = [[], []];
    const first = runs.run(order, { onLoading: (percent) => loads[0]!.push(percent) });
    const cold = workers[0]!;
    expect(cold.sent).toEqual([expect.objectContaining({ kind: 'run', runtime: 'python-quick' })]);
    cold.load();
    cold.say({ kind: 'started' });
    cold.say({ kind: 'done', status: 'ok', message: '' });
    expect((await first.done).status).toBe('ok');
    expect(cold.terminated).toBe(true);
    expect(loads[0]).toEqual([0, 100]);

    // In idle time the host loads the next worker, which reports its loading to nobody.
    runIdle();
    const warm = workers[1]!;
    expect(warm.sent).toEqual([{ kind: 'load', runtime: 'python-quick' }]);
    warm.load();
    expect(runs.warmState('python-quick')).toBe('ready');

    const second = runs.run(order, { onLoading: (percent) => loads[1]!.push(percent) });
    expect(workers).toHaveLength(2);
    expect(warm.sent[1]).toEqual(expect.objectContaining({ kind: 'run' }));
    warm.say({ kind: 'started' });
    warm.say({ kind: 'done', status: 'ok', message: '' });
    expect((await second.done).status).toBe('ok');
    expect(loads[1]).toEqual([]);
    expect(warm.terminated).toBe(true);
  });

  it('releases a warm worker after two minutes idle', () => {
    const runs = host();
    runs.warm('lua');
    const warm = workers[0]!;
    warm.load();
    vi.advanceTimersByTime(IDLE_RELEASE_MS - 1);
    expect(warm.terminated).toBe(false);
    expect(runs.warmState('lua')).toBe('ready');
    vi.advanceTimersByTime(1);
    expect(warm.terminated).toBe(true);
    expect(runs.warmState('lua')).toBe('none');
  });

  it('keeps one warm worker per runtime', () => {
    const runs = host();
    runs.warm('lua');
    runs.warm('lua');
    runs.warm('sql');
    expect(workers.map((worker) => worker.runtime)).toEqual(['lua', 'sql']);
  });

  it('keeps one warm worker in all, for the runtime warmed last', () => {
    const runs = host();
    runs.warm('lua');
    runs.warm('sql');
    expect(workers[0]!.terminated).toBe(true);
    expect(runs.warmState('lua')).toBe('none');
    expect(runs.warmState('sql')).toBe('loading');
  });

  it('shows the rest of the loading when the warm worker is still loading', async () => {
    const runs = host();
    runs.warm('lua');
    const warm = workers[0]!;
    warm.say({ kind: 'loading', percent: 40 });
    const loads: number[] = [];
    const handle = runs.run({ ...order, runtime: 'lua' }, { onLoading: (percent) => loads.push(percent) });
    warm.say({ kind: 'loading', percent: 100 });
    warm.say({ kind: 'started' });
    warm.say({ kind: 'done', status: 'ok', message: '' });
    await handle.done;
    expect(loads).toEqual([40, 100]);
  });

  it('drops a warm worker whose runtime would not load', () => {
    const runs = host();
    runs.warm('lua');
    workers[0]!.say({ kind: 'done', status: 'failed', message: 'runtime' });
    expect(workers[0]!.terminated).toBe(true);
    expect(runs.warmState('lua')).toBe('none');
  });
});

describe('concurrency', () => {
  it('runs at most two programs at once and starts the third when one ends', async () => {
    const runs = host();
    const a = runs.run(order);
    runs.run(order);
    const c = runs.run(order);
    expect(workers).toHaveLength(2);
    workers[0]!.say({ kind: 'started' });
    workers[0]!.say({ kind: 'done', status: 'ok', message: '' });
    await a.done;
    expect(workers).toHaveLength(3);
    c.stop();
    expect((await c.done).status).toBe('stopped');
  });

  it('stops a waiting run without starting it', async () => {
    const runs = host({ maxRuns: 1 });
    runs.run(order);
    const waiting = runs.run(order);
    waiting.stop();
    expect((await waiting.done).status).toBe('stopped');
    expect(workers).toHaveLength(1);
  });
});

describe('limits', () => {
  it('stops at the time limit, counted from the start of the program', async () => {
    const runs = host();
    const handle = runs.run({ ...order, limits: { ...RUN_LIMITS, timeMs: 1500 } });
    vi.advanceTimersByTime(5000);
    workers[0]!.say({ kind: 'started' });
    vi.advanceTimersByTime(1499);
    workers[0]!.say({ kind: 'out', stream: 'out', text: 'tick' });
    vi.advanceTimersByTime(1);
    const result = await handle.done;
    expect(result.status).toBe('time');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(1500);
    expect(workers[0]!.terminated).toBe(true);
  });

  it('fails a run whose runtime does not load in time', async () => {
    const runs = host();
    const handle = runs.run({ ...order, limits: { ...RUN_LIMITS, loadMs: 100 } });
    vi.advanceTimersByTime(100);
    expect(await handle.done).toMatchObject({ status: 'failed', message: 'load' });
  });

  it('times a compile step with the compile limit, not the load limit, and names it', async () => {
    const runs = host({ compileMs: 1000 });
    const handle = runs.run({ ...order, limits: { ...RUN_LIMITS, loadMs: 100 } });
    vi.advanceTimersByTime(50);
    workers[0]!.say({ kind: 'compiling' });
    vi.advanceTimersByTime(999);
    workers[0]!.say({ kind: 'compiling' });
    vi.advanceTimersByTime(1);
    const result = await handle.done;
    expect(result).toMatchObject({ status: 'failed', message: 'compile-time' });
    expect(statusLine(result, RUN_LIMITS)).toBe(
      'The compile step took longer than 60 seconds, so the program did not run.',
    );
  });

  it('starts the time limit when a compiled program starts', async () => {
    const runs = host({ compileMs: 1000 });
    const handle = runs.run({ ...order, limits: { ...RUN_LIMITS, loadMs: 100, timeMs: 500 } });
    workers[0]!.say({ kind: 'compiling' });
    vi.advanceTimersByTime(900);
    workers[0]!.say({ kind: 'started' });
    vi.advanceTimersByTime(500);
    expect(await handle.done).toMatchObject({ status: 'time' });
  });

  it('stops when Stop is pressed and ends the worker', async () => {
    const runs = host();
    const handle = runs.run(order);
    workers[0]!.say({ kind: 'started' });
    handle.stop();
    expect((await handle.done).status).toBe('stopped');
    expect(workers[0]!.terminated).toBe(true);
  });

  it('reports a worker out of memory as the memory limit', async () => {
    const runs = host();
    const handle = runs.run(order);
    workers[0]!.crash('Uncaught RangeError: Out of memory');
    expect((await handle.done).status).toBe('memory');
  });

  it('keeps only the output limit of text and says so', async () => {
    const runs = host();
    let out = '';
    const handle = runs.run(
      { ...order, limits: { ...RUN_LIMITS, outputChars: 10 } },
      { onOutput: (_, text) => (out += text) },
    );
    const worker = workers[0]!;
    worker.say({ kind: 'started' });
    worker.say({ kind: 'out', stream: 'out', text: '123456' });
    worker.say({ kind: 'out', stream: 'out', text: '7890abc' });
    worker.say({ kind: 'out', stream: 'out', text: 'more' });
    worker.say({ kind: 'done', status: 'ok', message: '' });
    expect(out).toBe('1234567890');
    expect((await handle.done).notes).toContain('output-cut');
  });

  it('does not say output was cut when it is exactly at the limit', async () => {
    const runs = host();
    let out = '';
    const handle = runs.run(
      { ...order, limits: { ...RUN_LIMITS, outputChars: 5 } },
      { onOutput: (_, text) => (out += text) },
    );
    workers[0]!.say({ kind: 'started' });
    workers[0]!.say({ kind: 'out', stream: 'out', text: '12345' });
    workers[0]!.say({ kind: 'done', status: 'ok', message: '' });
    expect(out).toBe('12345');
    expect((await handle.done).notes).toEqual([]);
  });
});

describe('the run end', () => {
  it('passes on interactive input and reports the run end in full', async () => {
    const runs = host();
    const prompts: string[] = [];
    const handle = runs.run(
      { ...order, stdin: { mode: 'interactive', text: '' } },
      { onInputWanted: (prompt) => prompts.push(prompt) },
    );
    const worker = workers[0]!;
    worker.say({ kind: 'started', version: 'Test 1.0', interactive: true });
    worker.say({ kind: 'input-wanted', prompt: 'name? ' });
    handle.input('Ada');
    handle.eof();
    worker.say({ kind: 'rich', mime: 'image/png', data: 'A'.repeat(3 * 1024 * 1024) });
    worker.say({ kind: 'done', status: 'error', exitCode: 2, message: '', written: [{ path: 'out.txt', text: 'x' }] });
    const result = await handle.done;
    expect(prompts).toEqual(['name? ']);
    expect(worker.sent.slice(1)).toEqual([{ kind: 'input', text: 'Ada' }, { kind: 'eof' }]);
    expect(result).toMatchObject({
      status: 'error',
      exitCode: 2,
      version: 'Test 1.0',
      written: [{ path: 'out.txt', text: 'x' }],
      notes: ['rich-refused'],
    });
  });

  it('says so when interactive input was asked for and the engine could not give it', async () => {
    const runs = host();
    const handle = runs.run({ ...order, stdin: { mode: 'interactive', text: '' } });
    workers[0]!.say({ kind: 'started', interactive: false });
    workers[0]!.say({ kind: 'done', status: 'ok', message: '', inputEnded: true });
    expect((await handle.done).notes).toEqual(['input-ended', 'interactive-unavailable']);
  });

  it('ends every worker on dispose', () => {
    const runs = host();
    runs.warm('lua');
    runs.run(order);
    runs.dispose();
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });

  it('ends a run asked of a disposed host at once, without a worker', async () => {
    const runs = host();
    runs.dispose();
    expect((await runs.run(order).done).status).toBe('stopped');
    expect(workers).toHaveLength(0);
  });

  it('ends the warm worker whose load failed and gives the next run a fresh one', async () => {
    const runs = host();
    runs.warm('lua');
    workers[0]!.say({ kind: 'done', status: 'failed', message: 'network' });
    const handle = runs.run({ ...order, runtime: 'lua' });
    expect(workers).toHaveLength(2);
    expect(workers[1]!.sent).toEqual([expect.objectContaining({ kind: 'run', runtime: 'lua' })]);
    workers[1]!.say({ kind: 'started' });
    workers[1]!.say({ kind: 'done', status: 'ok', message: '' });
    expect((await handle.done).status).toBe('ok');
  });
});
