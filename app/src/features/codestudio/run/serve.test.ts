// The worker's side of the run protocol with a stand-in scope and adapter (DESIGN 4.1 and 4.2). It covers:
// - A warm load that fails reports `done`, so the page ends the worker.
// - Output written before an adapter throws still reaches the page.
// - A cut sends one character past the limit, so the page can tell a cut from output at the limit.
// Lockdown and the Math.random seeding are stand-ins here: the real ones would change this test's own global.

import { describe, expect, it, vi } from 'vitest';
import type { RunEnd, RunRequest, RuntimeAdapter, WorkerMessage } from '../contracts/run';
import { RUN_LIMITS } from './protocol';
import { serve } from './serve';

vi.mock('./lockdown', () => ({ globalNames: () => new Set<string>(), lockDown: () => [] }));
// The real one fixes Math.random for the worker's one run; this file runs many.
vi.mock('./random', async (original) => ({
  ...(await original<typeof import('./random')>()),
  seedMathRandom: () => undefined,
}));

/** A stand-in worker scope: records what the worker sent, and lets the test send as the page would. */
function scope() {
  const sent: WorkerMessage[] = [];
  let listener: (event: MessageEvent) => void = () => undefined;
  return {
    sent,
    postMessage: (message: WorkerMessage) => sent.push(message),
    addEventListener: (_: 'message', next: (event: MessageEvent) => void) => (listener = next),
    page: (data: unknown) => listener({ data } as MessageEvent),
  };
}

const request: RunRequest = {
  kind: 'run',
  runtime: 'javascript',
  files: [{ path: 'main.js', text: 'x' }],
  main: 'main.js',
  args: [],
  stdin: { mode: 'prefilled', text: '' },
  limits: RUN_LIMITS,
  seed: 1,
};

const adapter = (run: RuntimeAdapter['run']): RuntimeAdapter => ({
  id: 'javascript',
  load: async () => undefined,
  run,
});

/** Waits until the worker has sent its `done`. */
async function ended(sent: WorkerMessage[]) {
  await vi.waitFor(() => expect(sent.some((message) => message.kind === 'done')).toBe(true));
  return sent;
}

describe('serve', () => {
  it('reports a warm load that fails, so the page ends the worker', async () => {
    const worker = scope();
    serve({ javascript: () => Promise.reject(new Error('network')) }, worker);
    worker.page({ kind: 'load', runtime: 'javascript' });
    expect(await ended(worker.sent)).toEqual([{ kind: 'done', status: 'failed', message: 'network' }]);
  });

  it('sends the output written before the adapter threw', async () => {
    const worker = scope();
    const throwing = adapter(async (_, emit) => {
      emit({ kind: 'out', stream: 'out', text: 'before' });
      throw new Error('broken');
    });
    serve({ javascript: async () => throwing }, worker);
    worker.page(request);
    const sent = await ended(worker.sent);
    expect(sent.filter((message) => message.kind === 'out' || message.kind === 'done')).toEqual([
      { kind: 'out', stream: 'out', text: 'before' },
      { kind: 'done', status: 'failed', message: 'broken' },
    ]);
  });

  it('sends one character past the output limit only when it cut', async () => {
    const texts = async (text: string) => {
      const worker = scope();
      const writer = adapter(async (_, emit): Promise<RunEnd> => {
        emit({ kind: 'out', stream: 'out', text });
        return { status: 'ok', message: '' };
      });
      serve({ javascript: async () => writer }, worker);
      worker.page({ ...request, limits: { ...RUN_LIMITS, outputChars: 5 } });
      const sent = await ended(worker.sent);
      return sent.flatMap((message) => (message.kind === 'out' ? [message.text] : []));
    };
    expect(await texts('12345')).toEqual(['12345']);
    expect(await texts('1234567')).toEqual(['123456']);
  });

  it('runs a prepare step before started, under the load limit', async () => {
    const worker = scope();
    const deadlines: string[] = [];
    const compiled: RuntimeAdapter = {
      ...adapter(async (_, emit, context) => {
        deadlines.push(`run ${Math.round(context.deadline - performance.now()) <= RUN_LIMITS.timeMs}`);
        emit({ kind: 'out', stream: 'out', text: 'ran' });
        return { status: 'ok', exitCode: 0, message: '' };
      }),
      version: 'v1',
      prepare: async (_, emit, context) => {
        deadlines.push(`prepare ${Math.round(context.deadline - performance.now()) > RUN_LIMITS.timeMs}`);
        emit({ kind: 'out', stream: 'err', text: 'compiled\n' });
        return null;
      },
    };
    serve({ javascript: async () => compiled }, worker);
    worker.page(request);
    const kinds = (await ended(worker.sent)).filter((message) => message.kind !== 'loading').map((m) => m.kind);
    expect(kinds).toEqual(['out', 'started', 'out', 'done']);
    expect(worker.sent.find((message) => message.kind === 'started')).toEqual({
      kind: 'started',
      version: 'v1',
      interactive: false,
    });
    expect(deadlines).toEqual(['prepare true', 'run true']);
  });

  it('ends the run without started when the prepare step ends it', async () => {
    const worker = scope();
    const run = vi.fn();
    const failing: RuntimeAdapter = {
      ...adapter(run),
      prepare: async () => ({ status: 'error', message: 'compile' }),
    };
    serve({ javascript: async () => failing }, worker);
    worker.page(request);
    const sent = await ended(worker.sent);
    expect(sent.some((message) => message.kind === 'started')).toBe(false);
    expect(sent.at(-1)).toEqual({ kind: 'done', status: 'error', message: 'compile' });
    expect(run).not.toHaveBeenCalled();
  });
});
