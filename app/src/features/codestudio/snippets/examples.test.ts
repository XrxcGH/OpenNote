// Every bundled example passes its own tests. Each runtime that has an adapter in this build (run/adapters.ts;
// lanes code:L05 to L08 add them) runs its examples' io cases in process, through the same adapter contract the run
// worker uses. JavaScript examples also run here with a small stand-in for the runtime's console and readline, so
// their known answers are checked on every build. The expected outputs are hand-worked (examples.ts).
import { describe, expect, it } from 'vitest';
import { PROJECT_LANGUAGES } from '../contracts';
import type { RunEnd, RunRequest, RuntimeId, WorkerMessage } from '../contracts';
import { pathProblem } from '../project/paths';
import { ADAPTERS } from '../run/adapters';
import { Mount } from '../run/mount';
import { RUN_LIMITS } from '../run/protocol';
import { seeded } from '../run/random';
import { Stdin } from '../run/stdin';
import { RUNTIMES } from '../window/languages';
import { EXAMPLE_TEST_PREFIX, EXAMPLES, examplesFor, helloText } from './examples';
import type { Example } from './examples';

/** How the output compares: `trim` ignores trailing whitespace and the final newline (DESIGN 9.1). */
const trimmed = (text: string) => text.replace(/\s+$/u, '');

describe('the bundled examples', () => {
  it('each has a runnable entry, valid paths, and tests of its own', () => {
    const ids = new Set<string>();
    for (const example of EXAMPLES) {
      expect(PROJECT_LANGUAGES).toContain(example.language);
      expect(ids.has(example.id)).toBe(false);
      ids.add(example.id);
      expect(example.files[example.entry], example.id).toBeTypeOf('string');
      for (const path of Object.keys(example.files)) expect(pathProblem(path), `${example.id} ${path}`).toBeNull();
      expect(example.tests.length, example.id).toBeGreaterThan(0);
      for (const test of example.tests) expect(test.id.startsWith(EXAMPLE_TEST_PREFIX)).toBe(true);
    }
  });

  it('has a hello starter for every language with an in-app runtime it covers, and SQL samples with a schema', () => {
    for (const language of ['python', 'javascript', 'typescript', 'lua', 'c', 'cpp'] as const) {
      expect(helloText(language), language).toContain('Hello, world!');
    }
    const samples = examplesFor('sql');
    expect(samples.map((one) => one.name)).toEqual(['sqlSelect', 'sqlJoin', 'sqlGroup']);
    for (const sample of samples) expect(sample.files['schema.sql']).toContain('CREATE TABLE');
  });
});

/** Runs a JavaScript example the way the studio's JavaScript runtime presents it: console.log and readline(). */
function runJavaScript(example: Example, stdin: string): string {
  const lines = stdin.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  let out = '';
  const sandboxConsole = { log: (...values: unknown[]) => (out += `${values.map(String).join(' ')}\n`) };
  const readline = () => lines.shift() ?? null;
  // The example is the app's own bundled text, not user input.
  new Function('console', 'readline', example.files[example.entry]!)(sandboxConsole, readline);
  return out;
}

describe('the JavaScript examples, run here', () => {
  for (const example of examplesFor('javascript')) {
    it(`${example.id} passes its tests`, () => {
      for (const test of example.tests) {
        expect(trimmed(runJavaScript(example, test.stdin ?? '')), test.name).toBe(trimmed(test.expected));
      }
    });
  }
});

/** One io case through a runtime adapter, in process. */
async function runCase(runtime: RuntimeId, example: Example, stdin: string): Promise<{ out: string; end: RunEnd }> {
  const adapter = await ADAPTERS[runtime]!();
  await adapter.load(() => undefined);
  const files = Object.entries(example.files).map(([path, text]) => ({ path, text }));
  const request: RunRequest = {
    kind: 'run',
    runtime,
    files,
    main: example.entry,
    args: [],
    stdin: { mode: 'prefilled', text: stdin },
    limits: RUN_LIMITS,
    seed: 1,
  };
  const random = seeded(1);
  let out = '';
  const emit = (message: WorkerMessage) => {
    if (message.kind === 'out' && message.stream === 'out') out += message.text;
  };
  const end = await adapter.run(request, emit, {
    stdin: new Stdin(stdin, false),
    files: new Mount(files),
    random: random.random,
    randomBytes: (bytes) => random.fill(bytes),
    deadline: performance.now() + RUN_LIMITS.timeMs,
  });
  return { out, end };
}

for (const [language, runtimes] of Object.entries(RUNTIMES)) {
  const runtime = runtimes![0]!;
  describe.skipIf(!ADAPTERS[runtime])(`the ${language} examples in ${runtime}`, () => {
    for (const example of examplesFor(language as Example['language'])) {
      it(`${example.id} passes its tests`, async () => {
        for (const test of example.tests.filter((one) => one.kind === 'io')) {
          const { out, end } = await runCase(runtime, example, test.stdin ?? '');
          expect(end.status, test.name).toBe('ok');
          expect(trimmed(out), test.name).toBe(trimmed(test.expected));
        }
      });
    }
  });
}
