// The run core in a real browser, with real workers. It covers:
// - lockdown with every adapter's allowances;
// - standard input, and interactive input through JSPI (gate G-R5);
// - the warm pool, the limits on time and memory, Stop, and the output cap;
// - the run end: seed, arguments, exit code, written files, version, and diagnostics.
// The runtimes are test fixtures; each runtime lane tests its own adapter.

// checks-disable-file modifiability: one describe block per feature
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeId } from '../contracts/run';
import { ALLOWANCES } from './adapters';
import { RunHost, fromWorker } from './host';
import type { RunCallbacks, RunOrder } from './host';
import { FORBIDDEN } from './lockdown';
import { RUN_LIMITS } from './protocol';
import { jspiAvailable } from './stdin';

// Each run starts a worker and a WebAssembly runtime, which a loaded machine slows.
vi.setConfig({ testTimeout: 60_000 });

const host = () =>
  new RunHost({
    createWorker: (runtime) =>
      fromWorker(
        new Worker(new URL('./fixtures/worker.ts', import.meta.url), { type: 'module', name: `test-${runtime}` }),
      ),
  });

function order(source: string, more: Partial<RunOrder> = {}): RunOrder {
  return {
    runtime: 'javascript',
    files: [{ path: 'main.js', text: source }],
    main: 'main.js',
    args: [],
    stdin: { mode: 'prefilled', text: '' },
    limits: RUN_LIMITS,
    seed: 1,
    ...more,
  };
}

async function run(runs: RunHost, request: RunOrder, callbacks: RunCallbacks = {}) {
  let out = '';
  let err = '';
  const loads: number[] = [];
  const handle = runs.run(request, {
    onOutput: (stream, text) => (stream === 'out' ? (out += text) : (err += text)),
    onLoading: (percent) => loads.push(percent),
    ...callbacks,
  });
  return { ...(await handle.done), out, err, loads };
}

const QUICK = { ...RUN_LIMITS, timeMs: 1500 };

describe('lockdown', () => {
  const lists: [string, readonly string[]][] = [
    ...(Object.entries(ALLOWANCES) as [RuntimeId, readonly string[]][]),
    ['an adapter asking for every forbidden name', FORBIDDEN],
  ];
  it.each(lists)('leaves no forbidden name with the allowances of %s', async (_name, allowances) => {
    const worker = new Worker(new URL('./fixtures/probe.ts', import.meta.url), { type: 'module' });
    const report = await new Promise<Record<string, unknown>>((resolve) => {
      worker.onmessage = (event: MessageEvent) => resolve(event.data as Record<string, unknown>);
      worker.postMessage([...allowances]);
    });
    worker.terminate();
    expect(report.left).toEqual([]);
    expect(report.present).toEqual([]);
    expect(report.makers).toEqual(['blocked', 'blocked', 'blocked', 'blocked']);
  });
});

describe('standard input', () => {
  it('gives a program reading three lines each in order, then EOF', async () => {
    const runs = host();
    const ran = await run(
      runs,
      order('const a = input(), b = input(), c = input(); print(a, b, c, input() === null);', {
        stdin: { mode: 'prefilled', text: 'one\ntwo\nthree\n' },
      }),
    );
    expect(ran.status).toBe('ok');
    expect(ran.out).toBe('one two three true\n');
    expect(ran.notes).toContain('input-ended');
    runs.dispose();
  });

  it('resumes a paused WebAssembly program after interactive input when JSPI is present', async (context) => {
    // Gate G-R5: the test browser runs the same Chromium engine as WebView2. Without JSPI the run reads the input box.
    if (!jspiAvailable())
      context.skip('This engine has no JSPI (WebAssembly.Suspending), so interactive input falls back.');
    const runs = host();
    const prompts: string[] = [];
    const replies = ['2', '3'];
    let send: (text: string) => void = () => undefined;
    const handle = runs.run(
      { ...order(''), runtime: 'lua', stdin: { mode: 'interactive', text: '' } },
      {
        onInputWanted: (prompt) => {
          prompts.push(prompt);
          send(replies.shift()!);
        },
        onOutput: (_stream, text) => prompts.push(`out:${text}`),
      },
    );
    send = handle.input;
    const result = await handle.done;
    expect(result.status).toBe('ok');
    expect(prompts).toEqual(['number? ', 'number? ', 'out:5\n']);
    expect(result.notes).toEqual([]);
    runs.dispose();
  });

  it('reads the input box when interactive input is not asked for', async () => {
    const runs = host();
    const ran = await run(runs, { ...order(''), runtime: 'lua', stdin: { mode: 'prefilled', text: '4\n5\n' } });
    expect(ran.out).toBe('9\n');
    runs.dispose();
  });
});

describe('warm pool', () => {
  it('starts the second run without a load message', async () => {
    const runs = host();
    const first = await run(runs, order('print(1)'));
    expect(first.loads[0]).toBe(0);
    expect(first.loads.at(-1)).toBe(100);
    await vi.waitFor(() => expect(runs.warmState('javascript')).toBe('ready'), { timeout: 30_000 });
    const second = await run(runs, order('print(2)'));
    expect(second.out).toBe('2\n');
    expect(second.loads).toEqual([]);
    runs.dispose();
  });
});

describe('limits', () => {
  it('stops a program at the time limit', async () => {
    const runs = host();
    expect((await run(runs, order('while (true) {}', { limits: QUICK }))).status).toBe('time');
    runs.dispose();
  });

  it('stops a program at the memory limit', async () => {
    const runs = host();
    const ran = await run(runs, order('const a = []; while (true) a.push(new Array(1e5).fill(1));'));
    expect(ran.status).toBe('memory');
    runs.dispose();
  });

  it('stops a program when Stop is pressed', async () => {
    const runs = host();
    const handle = runs.run(order('print("go"); while (true) {}'), {
      onStarted: () => setTimeout(() => handle.stop(), 500),
    });
    expect((await handle.done).status).toBe('stopped');
    runs.dispose();
  });

  it('keeps only the output limit of text', async () => {
    const runs = host();
    const ran = await run(
      runs,
      order('for (let i = 0; i < 100000; i++) print("line", i);', {
        limits: { ...RUN_LIMITS, outputChars: 1000 },
      }),
    );
    expect(ran.status).toBe('ok');
    expect(ran.notes).toContain('output-cut');
    expect(ran.out.length).toBeLessThanOrEqual(1000);
    runs.dispose();
  });

  it('leaves out an image above 2 MiB and keeps one below', async () => {
    const runs = host();
    const images: number[] = [];
    const ran = await run(runs, order('richImage(1000); richImage(3 * 1024 * 1024);'), {
      onRich: (_mime, data) => images.push(data.length),
    });
    expect(images).toHaveLength(1);
    expect(ran.notes).toContain('rich-refused');
    runs.dispose();
  });
});

describe('the run end', () => {
  it('reports the seed, arguments, exit code, written files, and version', async () => {
    const runs = host();
    const source = [
      'print(args.join(","));',
      'print(Math.floor(random() * 1e9));',
      'writeFile("out/result.txt", readFile("data.txt") + "!");',
      'exit(3);',
    ].join('\n');
    const files = [
      { path: 'main.js', text: source },
      { path: 'data.txt', text: 'input' },
    ];
    const a = await run(runs, { ...order(source), files, args: ['x', 'y z'], seed: 99 });
    const b = await run(runs, { ...order(source), files, args: ['x', 'y z'], seed: 99 });
    expect(a.out.split('\n')[0]).toBe('x,y z');
    expect(a.out).toBe(b.out);
    expect(a).toMatchObject({
      status: 'error',
      exitCode: 3,
      version: 'QuickJS test fixture',
      written: [{ path: 'out/result.txt', text: 'input!' }],
    });
    expect(a.elapsedMs).toBeGreaterThanOrEqual(0);
    runs.dispose();
  });

  it('maps an error to its project line', async () => {
    const runs = host();
    const items: unknown[] = [];
    const ran = await run(runs, order('print(1);\n\nnull.x;'), { onDiagnostics: (found) => items.push(...found) });
    expect(ran.status).toBe('error');
    expect(items).toEqual([expect.objectContaining({ file: 'main.js', line: 3 })]);
    runs.dispose();
  });
});
