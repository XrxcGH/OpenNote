// The inside of a run worker (DESIGN 4.1 to 4.5). A worker may load its runtime early, while the page is idle (a warm
// worker). When the run request comes, it locks itself down (lockdown.ts), runs the program once through the runtime's
// adapter, and reports. The page ends the worker after that, so no state is kept from one run to the next.

import type { Emit, RunRequest, RuntimeAdapter, RuntimeId, Stream, WorkerMessage } from '../contracts/run';
import { mapDiagnostics } from './diagnostics';
import { globalNames, lockDown } from './lockdown';
import { Mount } from './mount';
import { readHostMessage } from './protocol';
import { seedMathRandom, seeded } from './random';
import { Stdin, jspiAvailable } from './stdin';

export type AdapterLoader = () => Promise<RuntimeAdapter>;
export type AdapterRegistry = Partial<Record<RuntimeId, AdapterLoader>>;

/** Output goes to the page in pieces of this many characters. */
const PIECE = 4096;
/**
 * Messages sent as soon as the program writes. A runtime that runs synchronously keeps the worker busy until the run
 * ends, so output held back would be lost when the time limit or Stop ends the worker. Past this many messages,
 * output goes in pieces, so a program that prints in a loop does not flood the page.
 */
const PROMPT_MESSAGES = 1000;
/** Error output kept for the diagnostic mapper. */
const ERROR_TEXT = 64 * 1024;

interface WorkerScope {
  postMessage(message: WorkerMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/** Gathers output into pieces, cuts it at the limit, and keeps the error text for the mapper. */
class OutputGate {
  private pending = '';
  private stream: Stream = 'out';
  private sent = 0;
  private messages = 0;
  errorText = '';
  truncated = false;

  constructor(
    private send: (message: WorkerMessage) => void,
    private limit: number,
  ) {}

  write(stream: Stream, text: string): void {
    if (stream === 'err' && this.errorText.length < ERROR_TEXT) this.errorText += text.slice(0, ERROR_TEXT);
    if (this.truncated || text === '') return;
    if (stream !== this.stream) this.flush();
    this.stream = stream;
    const room = this.limit - this.sent - this.pending.length;
    if (text.length > room) {
      this.pending += text.slice(0, Math.max(0, room));
      this.truncated = true;
    } else {
      this.pending += text;
    }
    while (this.pending.length >= PIECE) this.flush(PIECE);
    if (this.truncated || this.messages < PROMPT_MESSAGES) this.flush();
  }

  flush(size = this.pending.length): void {
    if (this.pending === '') return;
    const piece = this.pending.slice(0, size);
    this.pending = this.pending.slice(size);
    this.sent += piece.length;
    this.messages += 1;
    this.send({ kind: 'out', stream: this.stream, text: piece });
  }
}

/** Starts the worker's side of the run protocol with the runtimes in `registry`. Call once, at the worker's start. */
export function serve(registry: AdapterRegistry, scope: WorkerScope = globalThis as unknown as WorkerScope): void {
  // Kept before lockdown takes postMessage and addEventListener off the global.
  const send = scope.postMessage.bind(scope);
  const before = globalNames();
  let loading: { runtime: RuntimeId; adapter: Promise<RuntimeAdapter> } | null = null;
  let ran = false;
  let answer: ((line: string | null) => void) | null = null;

  const load = (runtime: RuntimeId): Promise<RuntimeAdapter> => {
    if (loading) return loading.runtime === runtime ? loading.adapter : Promise.reject(new Error('runtime'));
    const loader = registry[runtime];
    const adapter = (async () => {
      if (!loader) throw new Error('runtime');
      const found = await loader();
      send({ kind: 'loading', percent: 0 });
      await found.load((percent) => send({ kind: 'loading', percent: Math.max(0, Math.min(99, percent)) }));
      send({ kind: 'loading', percent: 100 });
      return found;
    })();
    loading = { runtime, adapter };
    return adapter;
  };

  const run = async (request: RunRequest): Promise<void> => {
    const adapter = await load(request.runtime);
    const added = [...globalNames()].filter((name) => !before.has(name));
    const left = lockDown(globalThis, added, adapter.allowances ?? []);
    if (left.length > 0) {
      send({ kind: 'done', status: 'failed', message: `lockdown: ${left.join(', ')}` });
      return;
    }
    const random = seeded(request.seed);
    seedMathRandom(random);
    // One character past the limit, so the page can tell output that was cut from output exactly at the limit.
    const output = new OutputGate(send, request.limits.outputChars + 1);
    const emit: Emit = (message) => {
      if (message.kind === 'out') return output.write(message.stream, message.text);
      if (message.kind === 'started' || message.kind === 'done' || message.kind === 'loading') return;
      output.flush();
      send(message);
    };
    const interactive = request.stdin.mode === 'interactive' && jspiAvailable() && adapter.prefilledOnly !== true;
    const ask = (prompt: string) =>
      new Promise<string | null>((resolve) => {
        answer = resolve;
        emit({ kind: 'input-wanted', prompt });
      });
    const stdin = new Stdin(request.stdin.text, interactive, ask);
    const files = new Mount(request.files);
    send({ kind: 'started', ...(adapter.version ? { version: adapter.version } : {}), interactive });
    let end: Awaited<ReturnType<RuntimeAdapter['run']>>;
    try {
      end = await adapter.run(request, emit, {
        stdin,
        files,
        random: random.random,
        randomBytes: random.fill,
        deadline: performance.now() + request.limits.timeMs,
      });
    } finally {
      // Output the program wrote before a failure still reaches the page.
      output.flush();
    }
    const items = mapDiagnostics(adapter.diagnostics, output.errorText, request.files);
    if (items.length > 0) send({ kind: 'diagnostic', items });
    const written = files.written();
    send({
      kind: 'done',
      status: end.status,
      message: end.message,
      ...(end.exitCode === undefined ? {} : { exitCode: end.exitCode }),
      ...(written.length > 0 ? { written } : {}),
      ...(stdin.askedPastEnd ? { inputEnded: true } : {}),
    });
  };

  const fail = (error: unknown) =>
    send({ kind: 'done', status: 'failed', message: String((error as Error)?.message ?? error).slice(0, 4096) });

  // One listener for the worker's whole life: it stays after lockdown removes addEventListener, so interactive
  // input still arrives.
  scope.addEventListener('message', (event) => {
    const message = readHostMessage(event.data);
    if (!message) return;
    if (message.kind === 'load') {
      // A warm load that fails says so, so the page ends this worker and the next run loads a fresh one.
      load(message.runtime).catch(fail);
    } else if (message.kind === 'input' || message.kind === 'eof') {
      const reply = answer;
      answer = null;
      reply?.(message.kind === 'input' ? message.text : null);
    } else if (!ran) {
      ran = true;
      run(message).catch(fail);
    }
  });
}
