// The worker's side of the run protocol with a stand-in scope and adapter (DESIGN 4.1 and 4.2). It covers:
// - A warm load that fails reports `done`, so the page ends the worker.
// - Output written before an adapter throws still reaches the page.
// - A cut sends one character past the limit, so the page can tell a cut from output at the limit.
// Lockdown and the Math.random seeding are stand-ins here: the real ones would change this test's own global.
//
// It also covers two run ends:
// - Output goes to the page as it is written, so a run that the time limit ends keeps what it printed.
// - A runtime that reads only prefilled input makes the run not interactive, so the console says so.

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
// JSPI as in WebView2, whatever Node has.
vi.mock('./stdin', async (original) => ({
  ...(await original<typeof import('./stdin')>()),
  jspiAvailable: () => true,
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
});

describe('serve, while the program runs', () => {
  it('sends output as it is written, before the run ends', async () => {
    const worker = scope();
    let release = () => undefined as void;
    const waiting = new Promise<void>((resolve) => (release = resolve));
    const looping = adapter(async (_, emit): Promise<RunEnd> => {
      emit({ kind: 'out', stream: 'out', text: 'before the loop\n' });
      await waiting;
      return { status: 'ok', message: '' };
    });
    serve({ javascript: async () => looping }, worker);
    worker.page(request);
    await vi.waitFor(() =>
      expect(worker.sent).toContainEqual({ kind: 'out', stream: 'out', text: 'before the loop\n' }),
    );
    expect(worker.sent.some((message) => message.kind === 'done')).toBe(false);
    release();
    await ended(worker.sent);
  });

  it('reports a run as not interactive when the runtime reads only prefilled input', async () => {
    const started = async (prefilledOnly: boolean) => {
      const worker = scope();
      const reader: RuntimeAdapter = { ...adapter(async () => ({ status: 'ok', message: '' })), prefilledOnly };
      serve({ javascript: async () => reader }, worker);
      worker.page({ ...request, stdin: { mode: 'interactive', text: '' } });
      const sent = await ended(worker.sent);
      return sent.find((message) => message.kind === 'started');
    };
    expect(await started(false)).toMatchObject({ kind: 'started', interactive: true });
    expect(await started(true)).toMatchObject({ kind: 'started', interactive: false });
  });
});
