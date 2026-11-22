// C and C++ in a real browser, in a real run worker after lockdown (DESIGN 4.8). clang loads from the test server.
//
// - A run: the compile phase's lines come before `started`, then the program runs. It reads its input to the end,
//   exits with code 3, and opens no path outside the project mount.
// - A compile error: the run stops before `started`, and clang's message marks the line.
// - Interactive input through JSPI: the program pauses on fgets until the page answers, and fread keeps reading
//   when a line fills its first buffer exactly.
// - The live check: the check worker loads clang, locks down, and reports clang's note for printf.

// checks-disable-file modifiability: one describe block per feature
import { describe, expect, it, vi } from 'vitest';
import type { RunFile, RuntimeDiagnostic } from '../../contracts/run';
import { RunHost, fromWorker } from '../../run/host';
import type { RunCallbacks, RunOrder } from '../../run/host';
import { RUN_LIMITS } from '../../run/protocol';
import { jspiAvailable } from '../../run/stdin';
import { ClangChecker, type CheckWorker } from './checker';

// Each run loads the 105 MB pack into a fresh worker and compiles it, more slowly on a loaded machine.
vi.setConfig({ testTimeout: 240_000 });

const LIMITS = { ...RUN_LIMITS, loadMs: 180_000 };

const createWorker = () =>
  fromWorker(new Worker(new URL('./fixtures/worker.ts', import.meta.url), { type: 'module', name: 'test-cpp' }));

async function run(files: RunFile[], more: Partial<RunOrder> = {}, callbacks: RunCallbacks = {}) {
  const runs = new RunHost({ createWorker, limits: LIMITS });
  let out = '';
  let err = '';
  const order: string[] = [];
  const diagnostics: RuntimeDiagnostic[] = [];
  const handle = runs.run(
    {
      runtime: 'c',
      files,
      main: files[0]!.path,
      args: [],
      stdin: { mode: 'prefilled', text: '' },
      limits: LIMITS,
      seed: 1,
      ...more,
    },
    {
      onOutput: (stream, text) => {
        order.push(stream);
        if (stream === 'out') out += text;
        else err += text;
      },
      onStarted: () => order.push('started'),
      onDiagnostics: (items) => diagnostics.push(...items),
      ...callbacks,
    },
  );
  // Lets an interactive test answer through the handle.
  (callbacks as { handle?: typeof handle }).handle = handle;
  const done = await handle.done;
  runs.dispose();
  return { ...done, out, err, order, diagnostics };
}

const PROGRAM = String.raw`#include <stdio.h>
#include <stdlib.h>
static int opens(const char *path) { FILE *f = fopen(path, "r"); if (f) fclose(f); return f != NULL; }
int main(int argc, char **argv) {
  int ch, n = 0;
  while ((ch = getchar()) != EOF) n++;
  printf("%s read %d\n", argv[argc - 1], n);
  printf("data %d etc %d up %d\n", opens("data.txt"), opens("/etc/passwd"), opens("../data.txt"));
  fflush(stdout);
  exit(3);
}
`;

describe('C and C++ in a run worker', () => {
  it('compiles before started, then runs after lockdown with input, arguments and the exit code', async () => {
    const files = [
      { path: 'main.c', text: PROGRAM },
      { path: 'data.txt', text: 'x' },
    ];
    const result = await run(files, { args: ['last'], stdin: { mode: 'prefilled', text: 'ab\nc\n' } });
    expect(result).toMatchObject({ status: 'error', exitCode: 3 });
    expect(result.version).toMatch(/^clang 22\./);
    expect(result.out).toBe('last read 5\ndata 1 etc 0 up 0\n');
    expect(result.err).toMatch(/Compiling main\.c with clang 22\.\S+ \(C17\)/);
    expect(result.order.indexOf('started')).toBeGreaterThan(0);
    expect(result.order.slice(0, result.order.indexOf('started')).every((stream) => stream === 'err')).toBe(true);
    expect(result.notes).toContain('input-ended');
  });

  it('stops at a compile error before started and marks the line', async () => {
    const result = await run([{ path: 'main.cpp', text: 'int main() {\n  int x = 1\n  return x;\n}\n' }], {
      runtime: 'cpp',
    });
    expect(result).toMatchObject({ status: 'error', message: 'compile' });
    expect(result.order).not.toContain('started');
    expect(result.diagnostics).toContainEqual({
      file: 'main.cpp',
      line: 2,
      column: 12,
      kind: 'error',
      message: "expected ';' at end of declaration",
    });
  });

  it('pauses on input until the page answers when JSPI is present', async (context) => {
    if (!jspiAvailable()) context.skip('This engine has no JSPI, so interactive input falls back.');
    const prompts: string[] = [];
    const replies = ['Ada'];
    const callbacks: RunCallbacks & { handle?: { input(text: string): void; eof(): void } } = {
      onInputWanted: () => {
        prompts.push('asked');
        const reply = replies.shift();
        if (reply === undefined) callbacks.handle?.eof();
        else callbacks.handle?.input(reply);
      },
    };
    const program = String.raw`#include <stdio.h>
int main(void) { char name[32]; printf("name? "); fflush(stdout); while (fgets(name, sizeof name, stdin)) printf("hi %s", name); return 0; }
`;
    const result = await run(
      [{ path: 'main.c', text: program }],
      { stdin: { mode: 'interactive', text: '' } },
      callbacks,
    );
    expect(result).toMatchObject({ status: 'ok', out: 'name? hi Ada\n' });
    expect(prompts).toEqual(['asked', 'asked']);
    expect(result.notes).toEqual([]);
  });

  it('keeps fread going when a typed line fills its first buffer exactly', async (context) => {
    if (!jspiAvailable()) context.skip('This engine has no JSPI, so interactive input falls back.');
    // musl's fread reads with two buffers: count - 1 bytes, then its own. "abc\n" fills the first one.
    const replies = ['abc', 'de'];
    let asked = 0;
    const callbacks: RunCallbacks & { handle?: { input(text: string): void; eof(): void } } = {
      onInputWanted: () => {
        asked += 1;
        const reply = replies.shift();
        if (reply === undefined) callbacks.handle?.eof();
        else callbacks.handle?.input(reply);
      },
    };
    const program = String.raw`#include <stdio.h>
int main(void) { char b[6] = {0}; size_t n = fread(b, 1, 5, stdin); printf("%zu %d [%s]\n", n, feof(stdin), b); return 0; }
`;
    const result = await run(
      [{ path: 'main.c', text: program }],
      { stdin: { mode: 'interactive', text: '' } },
      callbacks,
    );
    expect(result).toMatchObject({ status: 'ok', out: '5 0 [abc\nd]\n' });
    expect(asked).toBe(2);
    expect(result.notes).toEqual([]);
  });
});

describe('the live check worker', () => {
  it('loads clang, locks down, and reports the note that names <stdio.h>', async () => {
    const checker = new ClangChecker({
      createWorker: () =>
        new Worker(new URL('./fixtures/checkWorker.ts', import.meta.url), {
          type: 'module',
          name: 'test-clang-check',
        }) as unknown as CheckWorker,
      timeoutMs: 200_000,
    });
    const file = { path: 'main.c', text: 'int main(void) {\n  printf("hi");\n  return 0;\n}\n' };
    const items = await checker.check('c', file, [file]);
    expect(items).toContainEqual({
      file: 'main.c',
      line: 2,
      column: 3,
      kind: 'note',
      message: "include the header <stdio.h> or explicitly provide a declaration for 'printf'",
    });
    // The second check reuses the warm worker and its compiled clang.
    const fixed = { path: 'main.c', text: `#include <stdio.h>\n${file.text}` };
    expect(await checker.check('c', fixed, [fixed])).toEqual([]);
    expect(checker.warm).toBe(true);
    checker.release();
  });
});
