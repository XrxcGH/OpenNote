import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubjectError } from '../errors';
import { runTask, serveTasks } from './worker';
import type { TaskContext, TaskFn, WorkerScope } from './worker';

/** Sums 1..n, reporting progress every 1000 steps; refuses negative n with a SubjectError. */
const sumTo: TaskFn<number, number> = (n: number, ctx: TaskContext) => {
  if (n < 0) throw new SubjectError('domain', 'n');
  let s = 0;
  for (let i = 1; i <= n; i += 1) {
    s += i;
    if (i % 1000 === 0) ctx.progress(i / n);
  }
  return s;
};

const TASKS = { sumTo: sumTo as TaskFn<never, unknown> };

/** A stand-in for a module worker: the same serveTasks protocol, delivered on later turns of the event loop. */
class FakeWorker {
  terminated = false;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  private readonly inside: ((event: MessageEvent) => void)[] = [];

  constructor() {
    const scope: WorkerScope = {
      postMessage: (data) => setTimeout(() => this.emit('message', { data }), 0),
      addEventListener: (_type, listener) => this.inside.push(listener),
    };
    serveTasks(TASKS, scope);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(data: unknown): void {
    setTimeout(() => this.inside.forEach((l) => l({ data } as MessageEvent)), 0);
  }

  terminate(): void {
    this.terminated = true;
    this.listeners.clear();
  }

  private emit(type: string, event: unknown): void {
    if (!this.terminated) (this.listeners.get(type) ?? []).forEach((l) => l(event));
  }
}

const spec = (spawn?: () => Worker) => ({ task: 'sumTo', spawn, load: () => Promise.resolve(sumTo) });

describe('worker runner on the main thread', () => {
  it('runs the engine and reports progress up to 1', async () => {
    const seen: number[] = [];
    await expect(runTask(spec(), 10_000, { onProgress: (f) => seen.push(f) })).resolves.toBe(50_005_000);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('passes engine errors through and honors a cancel made before the start', async () => {
    await expect(runTask(spec(), -1)).rejects.toMatchObject({ code: 'domain' });
    const controller = new AbortController();
    controller.abort();
    await expect(runTask(spec(), 5, { signal: controller.signal })).rejects.toMatchObject({ code: 'canceled' });
  });
});

describe('worker runner in a worker', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs the named task in the worker and ends the worker after', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    let made: FakeWorker | null = null;
    const spawn = () => (made = new FakeWorker()) as unknown as Worker;
    const seen: number[] = [];
    await expect(runTask(spec(spawn), 2000, { onProgress: (f) => seen.push(f) })).resolves.toBe(2_001_000);
    expect(seen).toContain(1);
    expect((made as FakeWorker | null)?.terminated).toBe(true);
  });

  it('rebuilds subject errors, refuses unknown tasks and cancels by ending the worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const spawn = () => new FakeWorker() as unknown as Worker;
    await expect(runTask(spec(spawn), -3)).rejects.toBeInstanceOf(SubjectError);
    const unknown = { task: 'nope', spawn, load: () => Promise.resolve(sumTo) };
    await expect(runTask(unknown, 1)).rejects.toMatchObject({ code: 'domain' });
    const controller = new AbortController();
    const pending = runTask(spec(spawn), 10, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'canceled' });
  });

  it('falls back to the main thread when the worker cannot start', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const broken = () => {
      throw new Error('blocked');
    };
    await expect(runTask(spec(broken), 4)).resolves.toBe(10);
  });
});
