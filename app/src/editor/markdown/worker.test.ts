import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTextBlock } from './parse';
import { parseInWorker, resetParseWorker } from './worker';
import type { ParseRequest, ParseResponse } from './worker';
import { respond } from './workerMain';

/** A stand-in for a module worker that answers with the real worker's handler, a task later. */
class FakeWorker {
  static made: FakeWorker[] = [];
  static answer: (request: ParseRequest) => ParseResponse = respond;
  onmessage: ((event: { data: ParseResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly sent: ParseRequest[] = [];
  terminated = false;

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.made.push(this);
  }

  postMessage(request: ParseRequest): void {
    this.sent.push(request);
    setTimeout(() => this.onmessage?.({ data: FakeWorker.answer(request) }), 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  resetParseWorker();
  vi.unstubAllGlobals();
  FakeWorker.made = [];
  FakeWorker.answer = respond;
});

describe('parsing in the worker', () => {
  it('parses on the main thread where there are no workers', async () => {
    const doc = await parseInWorker('# Title\n\nbody');
    expect(doc.toJSON()).toEqual(parseTextBlock('# Title\n\nbody').toJSON());
  });

  it('starts one module worker and gives back the document it sends', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const [a, b] = await Promise.all([parseInWorker('- one\n- two'), parseInWorker('> quote')]);
    expect(a.toJSON()).toEqual(parseTextBlock('- one\n- two').toJSON());
    expect(b.toJSON()).toEqual(parseTextBlock('> quote').toJSON());
    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0].options.type).toBe('module');
    expect(FakeWorker.made[0].sent.map((request) => request.markdown)).toEqual(['- one\n- two', '> quote']);
  });

  it('parses here when the worker could not', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    FakeWorker.answer = ({ id }) => ({ id, doc: null });
    expect((await parseInWorker('*text*')).toJSON()).toEqual(parseTextBlock('*text*').toJSON());
  });

  it('finishes what the worker owed when it fails, and stays on the main thread after', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    FakeWorker.answer = () => ({ id: -1, doc: null });
    const owed = parseInWorker('owed');
    FakeWorker.made[0].onerror?.();
    expect((await owed).textContent).toBe('owed');
    expect(FakeWorker.made[0].terminated).toBe(true);
    expect((await parseInWorker('later')).textContent).toBe('later');
    expect(FakeWorker.made).toHaveLength(1);
  });

  it('rejects with the reason when its signal aborts', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    const parsing = parseInWorker('slow', controller.signal);
    controller.abort(new Error('stale'));
    await expect(parsing).rejects.toThrow('stale');
    const aborted = AbortSignal.abort(new Error('already'));
    await expect(parseInWorker('x', aborted)).rejects.toThrow('already');
  });

  it('answers every request with JSON, or null when parsing throws', () => {
    expect(respond({ id: 7, markdown: 'a' })).toEqual({ id: 7, doc: parseTextBlock('a').toJSON() });
    const bad = {
      id: 8,
      get markdown(): string {
        throw new Error('no');
      },
    };
    expect(respond(bad)).toEqual({ id: 8, doc: null });
  });
});
