// The call harnesses and the test runners with the real runtimes in Node (DESIGN 9): QuickJS with Sucrase,
// MicroPython, Pyodide, and wasmoon (Lua 5.4). Expected values are hand-worked, or come from the unittest and Jest
// documentation (tests run in the order the loader sorts method names; a failed assertEqual(1, 2) says "1 != 2").

// checks-disable-file modifiability: one describe block per feature
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { LuaFactory } from 'wasmoon';
import { loadPyodide } from 'pyodide';
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import releaseSync from '@jitl/quickjs-wasmfile-release-sync';
import { transform } from 'sucrase';
import type { RunFile, RunRequest, TestCase, TestResult, WorkerMessage } from '../contracts';
import { Mount } from '../run/mount';
import type { RunHandle, RunOrder, RunResult } from '../run/host';
import { RUN_LIMITS } from '../run/protocol';
import { seeded } from '../run/random';
import { Stdin } from '../run/stdin';
import { cappedHeap, runProgram } from '../runtimes/js/engine';
import type { Engine } from '../runtimes/js/engine';
import { loadMicroPythonEngine } from '../runtimes/python/micropython';
import { cutOffPyodide, loadPyodideEngine } from '../runtimes/python/pyodide';
import type { LoadPyodide } from '../runtimes/python/pyodide';
import { runPython } from '../runtimes/python/session';
import type { PythonEngine } from '../runtimes/python/session';
import type { Runner } from '../window/runner';
import { compareJson } from './compare';
import { CALL_MARKER, buildCall, lastCallResult } from './harness';
import { withTests } from './runCases';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const ROOT = new URL('../../../../../', import.meta.url);
const MICROPYTHON_WASM = fileURLToPath(
  new URL('node_modules/@micropython/micropython-webassembly-pyscript/micropython.wasm', ROOT),
);
const PYODIDE_DIR = fileURLToPath(new URL('node_modules/pyodide/', ROOT));

let full: PythonEngine;
let quickjs: Engine;
beforeAll(async () => {
  full = await loadPyodideEngine(loadPyodide as unknown as LoadPyodide, PYODIDE_DIR);
  cutOffPyodide(full);
  quickjs = {
    quickjs: await newQuickJSWASMModuleFromVariant(
      newVariant(releaseSync, { wasmMemory: cappedHeap(RUN_LIMITS.memoryBytes) }),
    ),
    transform,
  };
});

/** A runner over the real runtimes. Each run is finished before its handle is given back. */
const nodeRunner: Runner = {
  run(order, callbacks): RunHandle {
    const started = performance.now();
    const request: RunRequest = { kind: 'run', ...order };
    const done = (async (): Promise<RunResult> => {
      const emit = (message: WorkerMessage) => {
        if (message.kind === 'out') callbacks.onOutput?.(message.stream, message.text);
        else if (message.kind === 'test') callbacks.onTest?.(message.result);
        else if (message.kind === 'rich') callbacks.onRich?.(message.mime, message.data);
      };
      const random = seeded(request.seed);
      const files = new Mount(request.files);
      const common = {
        stdin: new Stdin(request.stdin.text, false),
        files,
        random: random.random,
        randomBytes: random.fill,
        deadline: performance.now() + request.limits.timeMs,
      };
      const python = request.runtime === 'python-full' || request.runtime === 'python-quick';
      const end = python
        ? runPython(
            request.runtime === 'python-full' ? full : await loadMicroPythonEngine(MICROPYTHON_WASM),
            request,
            emit,
            common,
          )
        : runProgram(quickjs, request, emit, common);
      return {
        status: end.status,
        ...(end.exitCode === undefined ? {} : { exitCode: end.exitCode }),
        message: end.message,
        elapsedMs: performance.now() - started,
        written: [],
        notes: [],
      };
    })();
    return { stop: () => undefined, input: () => undefined, eof: () => undefined, done };
  },
};

const file = (path: string, text: string): RunFile => ({ path, text });

const lines = (...text: string[]) => text.join('\n') + '\n';

function orderOf(runtime: RunOrder['runtime'], files: RunFile[], more: Partial<RunOrder> = {}): RunOrder {
  return {
    runtime,
    files,
    main: files[0]!.path,
    args: [],
    stdin: { mode: 'prefilled', text: '' },
    limits: RUN_LIMITS,
    seed: 1,
    ...more,
  };
}

/** Runs a case list through the runner and returns the results by case ID. */
async function runCases(order: RunOrder, cases: TestCase[], framework = false): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const handle = withTests(nodeRunner).run(
    { ...order, test: { cases, framework } },
    { onTest: (result) => results.push(result) },
  );
  const end = await handle.done;
  expect(end.status).toBe('ok');
  return results;
}

const call = (id: string, fn: string, callArgs: string, expected: string, extra: Partial<TestCase> = {}): TestCase => ({
  id,
  name: id,
  kind: 'call',
  fn,
  callArgs,
  expected,
  compare: { mode: 'exact' },
  order: 0,
  ...extra,
});

const io = (id: string, stdin: string, expected: string, extra: Partial<TestCase> = {}): TestCase => ({
  id,
  name: id,
  kind: 'io',
  stdin,
  expected,
  compare: { mode: 'trim' },
  order: 0,
  ...extra,
});

describe('call harness', () => {
  // two_sum([2, 7, 11, 15], 9): 2 + 7 is 9, at indexes 0 and 1.
  const PY_TWO_SUM = lines(
    'def two_sum(nums, target):',
    '    seen = {}',
    '    for i, n in enumerate(nums):',
    '        if target - n in seen:',
    '            return [seen[target - n], i]',
    '        seen[n] = i',
  );
  const JS_TWO_SUM = lines(
    'function two_sum(nums, target) {',
    '  const seen = new Map();',
    '  for (let i = 0; i < nums.length; i++) {',
    '    if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];',
    '    seen.set(nums[i], i);',
    '  }',
    '}',
  );
  const TS_TWO_SUM = JS_TWO_SUM.replace('(nums, target)', '(nums: number[], target: number): number[] | undefined');
  const LUA_TWO_SUM = lines(
    'function two_sum(nums, target)',
    '  local seen = {}',
    '  for i, n in ipairs(nums) do',
    '    local j = seen[target - n]',
    '    if j then return {j - 1, i - 1} end',
    '    seen[n] = i',
    '  end',
    'end',
  );

  it.each([
    ['python-full', 'main.py', PY_TWO_SUM],
    ['python-quick', 'main.py', PY_TWO_SUM],
    ['javascript', 'main.js', JS_TWO_SUM],
    ['typescript', 'main.ts', TS_TWO_SUM],
  ] as const)('%s: two_sum([2,7,11,15], 9) returns [0,1] and compares equal', async (runtime, path, text) => {
    const [result] = await runCases(orderOf(runtime, [file(path, text)]), [
      call('c1', 'two_sum', '[[2,7,11,15],9]', '[0, 1]'),
    ]);
    expect(result).toMatchObject({ status: 'pass', actual: '[0, 1]', expected: '[0, 1]' });
  });

  it('python: a failing case shows both values; the user file never runs its __main__ block', async () => {
    const text = `${PY_TWO_SUM}\nif __name__ == "__main__":\n    print("main ran")\n`;
    const [result] = await runCases(orderOf('python-full', [file('main.py', text)]), [
      call('c1', 'two_sum', '[[3,3],6]', '[1, 0]'),
    ]);
    expect(result).toMatchObject({ status: 'fail', actual: '[0, 1]', expected: '[1, 0]' });
  });

  it('None and null map to each other, in both directions', async () => {
    const py = 'def echo(x):\n    return x\n';
    const js = 'function echo(x) { return x; }\n';
    for (const [runtime, path, text] of [
      ['python-full', 'main.py', py],
      ['python-quick', 'main.py', py],
      ['javascript', 'main.js', js],
    ] as const) {
      const results = await runCases(orderOf(runtime, [file(path, text)]), [
        call('a', 'echo', '[null]', 'null'),
        call('b', 'echo', '[[1, null, {"k": null}]]', '[1, null, {"k": null}]'),
      ]);
      expect(results.map((one) => one.status)).toEqual(['pass', 'pass']);
    }
  });

  it('floats keep their precision: 0.1 + 0.2 prints as 0.30000000000000004 in each language', async () => {
    const cases = [call('a', 'add', '[0.1, 0.2]', '0.30000000000000004')];
    for (const [runtime, path, text] of [
      ['python-full', 'main.py', 'def add(a, b):\n    return a + b\n'],
      ['python-quick', 'main.py', 'def add(a, b):\n    return a + b\n'],
      ['javascript', 'main.js', 'function add(a, b) { return a + b; }\n'],
    ] as const) {
      const [result] = await runCases(orderOf(runtime, [file(path, text)]), cases);
      expect(result, runtime).toMatchObject({ status: 'pass', actual: '0.30000000000000004' });
    }
  });

  it('python: tuples and sets become lists, dict keys become strings, nan becomes null', async () => {
    const text = 'def make():\n    return {"t": (1, 2), "s": {3}, 4: float("nan")}\n';
    const built = buildCall({ runtime: 'python-full', path: 'main.py', text, fn: 'make', callArgs: '[]' })!;
    const files = [file('main.py', text), file(built.extra!.path, built.extra!.text)];
    const messages: string[] = [];
    await nodeRunner.run(orderOf('python-full', files, { main: built.extra!.path }), {
      onOutput: (_, out) => messages.push(out),
    }).done;
    const printed = lastCallResult(messages.join(''))!;
    expect(JSON.parse(printed)).toEqual({ t: [1, 2], s: [3], '4': null });
  });

  it('the class method form Solution.two_sum works', async () => {
    const text = `class Solution:\n    @staticmethod\n    def double(x):\n        return x * 2\n`;
    const [result] = await runCases(orderOf('python-full', [file('main.py', text)]), [
      call('c1', 'Solution.double', '[21]', '42'),
    ]);
    expect(result).toMatchObject({ status: 'pass' });
  });

  it('output without a trailing newline does not hide the result', async () => {
    const py = 'import sys\ndef f():\n    sys.stdout.write("abc")\n    return 1\n';
    const [result] = await runCases(orderOf('python-full', [file('main.py', py)]), [call('c1', 'f', '[]', '1')]);
    expect(result).toMatchObject({ status: 'pass' });
  });

  it('a dataclass with postponed annotations works (the file is a module in sys.modules)', async () => {
    const text = lines(
      'from __future__ import annotations',
      'from dataclasses import dataclass',
      '',
      '@dataclass',
      'class P:',
      '    x: int',
      '',
      'def f():',
      '    return P(7).x',
    );
    const [result] = await runCases(orderOf('python-full', [file('main.py', text)]), [call('c1', 'f', '[]', '7')]);
    expect(result).toMatchObject({ status: 'pass' });
  });

  it('Solution.add on an instance method builds the instance', async () => {
    const text = 'class Solution:\n    def add(self, a, b):\n        return a + b\n';
    for (const runtime of ['python-full', 'python-quick'] as const) {
      const [result] = await runCases(orderOf(runtime, [file('main.py', text)]), [
        call('c1', 'Solution.add', '[2, 3]', '5'),
      ]);
      expect(result, runtime).toMatchObject({ status: 'pass' });
    }
  });

  it('a function that returns a promise says async is not supported', async () => {
    const [result] = await runCases(orderOf('javascript', [file('main.js', 'async function f() { return 1; }\n')]), [
      call('c1', 'f', '[]', '1'),
    ]);
    expect(result?.status).toBe('error');
    expect(result?.message).toMatch(/Async functions are not supported/);
  });

  it('very deep arguments give an error result instead of a stuck run', async () => {
    const deep = '['.repeat(20000) + ']'.repeat(20000);
    const [result] = await runCases(orderOf('python-full', [file('main.py', 'def f(x):\n    return 1\n')]), [
      call('c1', 'f', `[${deep}]`, '1'),
    ]);
    expect(result?.status).toBe('error');
  });

  it('a file in a folder runs with the harness next to it', async () => {
    const [result] = await runCases(orderOf('python-full', [file('src/main.py', 'def one():\n    return 1\n')]), [
      call('c1', 'one', '[]', '1'),
    ]);
    expect(result).toMatchObject({ status: 'pass' });
  });

  it('refuses a name that is not a function name, and arguments that are not a JSON list', async () => {
    const order = orderOf('python-full', [file('main.py', 'def f():\n    return 1\n')]);
    const [badName, badArgs] = await runCases(order, [
      call('a', 'f(); import os', '[]', '1'),
      call('b', 'f', '{}', '1'),
    ]);
    expect(badName?.status).toBe('error');
    expect(badArgs?.status).toBe('error');
    expect(buildCall({ runtime: 'c', path: 'main.c', text: '', fn: 'f', callArgs: '[]' })).toBeNull();
  });

  it('a function that raises is an error with the error line', async () => {
    const [result] = await runCases(
      orderOf('python-full', [file('main.py', 'def f():\n    raise ValueError("boom")\n')]),
      [call('a', 'f', '[]', '1')],
    );
    expect(result).toMatchObject({ status: 'error', message: 'ValueError: boom' });
  });

  describe('lua (wasmoon, Lua 5.4)', () => {
    async function luaCall(text: string, fn: string, callArgs: string): Promise<string | null> {
      const built = buildCall({ runtime: 'lua', path: 'main.lua', text, fn, callArgs })!;
      const lua = await new LuaFactory().createEngine();
      const out: string[] = [];
      lua.global.set('print', (...args: unknown[]) => out.push(args.join('\t')));
      try {
        await lua.doString(built.text);
      } finally {
        lua.global.close();
      }
      return lastCallResult(out.join('\n'));
    }

    it('the result marker starts on a line of its own, after output with no newline', async () => {
      const built = buildCall({
        runtime: 'lua',
        path: 'main.lua',
        text: 'function f() return 1 end',
        fn: 'f',
        callArgs: '[]',
      })!;
      const lua = await new LuaFactory().createEngine();
      const printed: string[] = [];
      lua.global.set('print', (...args: unknown[]) => printed.push(args.join('\t')));
      try {
        await lua.doString(built.text);
      } finally {
        lua.global.close();
      }
      expect(printed).toEqual(['\n' + CALL_MARKER + '1']);
    });

    it('two_sum([2,7,11,15], 9) gives [0,1]', async () => {
      expect(await luaCall(LUA_TWO_SUM, 'two_sum', '[[2,7,11,15],9]')).toBe('[0,1]');
    });

    it('null in a list stays null, and a nil result is null', async () => {
      expect(await luaCall('function echo(x) return x end', 'echo', '[[1,null,"a"]]')).toBe('[1,null,"a"]');
      expect(await luaCall('function nothing() end', 'nothing', '[]')).toBe('null');
    });

    it('floats keep their precision and whole numbers print without a point', async () => {
      expect(await luaCall('function add(a, b) return a + b end', 'add', '[0.1, 0.2]')).toBe('0.30000000000000004');
      expect(await luaCall('function add(a, b) return a + b end', 'add', '[2, 3]')).toBe('5');
    });

    it('objects, nested lists, escapes and unicode survive the round trip', async () => {
      const json = '[{"k":[1,2,{"z":true}],"s":"a\\"b\\n\\u00e9"}]';
      const got = await luaCall('function echo(x) return x end', 'echo', json);
      expect(compareJson(got!, '{"k":[1,2,{"z":true}],"s":"a\\"b\\n\\u00e9"}', { mode: 'exact' }).pass).toBe(true);
    });

    it('an empty list stays a list', async () => {
      expect(await luaCall('function f() return {} end', 'f', '[]')).toBe('[]');
    });
  });
});

describe('io cases and limits', () => {
  it('compares output with each case; a failing case carries expected and actual', async () => {
    const order = orderOf('python-full', [file('main.py', 'a, b = map(int, input().split())\nprint(a + b)\n')]);
    const results = await runCases(order, [io('ok', '2 3\n', '5'), io('bad', '2 2\n', '5')]);
    expect(results.map((one) => one.status)).toEqual(['pass', 'fail']);
    expect(results[1]).toMatchObject({ expected: '5', actual: '4\n' });
  });

  it('stops a case at its own time limit: "Time limit exceeded"', async () => {
    const order = orderOf('javascript', [file('main.js', 'while (true) {}\n')]);
    const [result] = await runCases(order, [io('slow', '', 'never', { timeMs: 300 })]);
    expect(result).toMatchObject({ status: 'time' });
    expect(result!.message).toContain('0.3');
  });

  it('an error in the program is an error result with its last line', async () => {
    const [result] = await runCases(orderOf('python-full', [file('main.py', 'print(1 // 0)\n')]), [io('e', '', '1')]);
    expect(result).toMatchObject({ status: 'error' });
    expect(result!.message).toContain('ZeroDivisionError');
  });
});

describe('framework tests', () => {
  // unittest sorts the test methods of a class by name (TestLoader.sortTestMethodsUsing is cmp), so the order is
  // test_a, test_b, test_c, test_d.
  const SUITE = `import unittest

class Maths(unittest.TestCase):
    def test_d_skips(self):
        self.skipTest("later")

    def test_c_errors(self):
        1 / 0

    def test_b_fails(self):
        self.assertEqual(1, 2)

    def test_a_passes(self):
        self.assertEqual(2 + 2, 4)

if __name__ == "__main__":
    unittest.main()
`;

  it('unittest reports one result per test, in discovery order', async () => {
    const results = await runCases(orderOf('python-full', [file('main.py', SUITE)]), [], true);
    expect(results.map((one) => [one.name, one.status])).toEqual([
      ['Maths.test_a_passes', 'pass'],
      ['Maths.test_b_fails', 'fail'],
      ['Maths.test_c_errors', 'error'],
      ['Maths.test_d_skips', 'skipped'],
    ]);
    expect(results[1]).toMatchObject({ message: '1 != 2', location: { file: 'main.py', line: 11 } });
    expect(results[2]).toMatchObject({ message: 'division by zero', location: { file: 'main.py', line: 8 } });
  });

  it('unittest keeps a test whose output has no trailing newline', async () => {
    const text = lines(
      'import unittest',
      '',
      'class T(unittest.TestCase):',
      '    def test_a(self):',
      '        print("x", end="")',
      '    def test_b(self):',
      '        pass',
    );
    const results = await runCases(orderOf('python-full', [file('main.py', text)]), [], true);
    expect(results.map((one) => [one.name, one.status])).toEqual([
      ['T.test_a', 'pass'],
      ['T.test_b', 'pass'],
    ]);
  });

  it('unittest finds tests in other test files of the project', async () => {
    const files = [
      file('main.py', 'def double(x):\n    return x * 2\n'),
      file(
        'test_main.py',
        lines(
          'import unittest',
          'from main import double',
          '',
          'class T(unittest.TestCase):',
          '    def test_double(self):',
          '        self.assertEqual(double(4), 8)',
        ),
      ),
    ];
    const results = await runCases(orderOf('python-full', files), [], true);
    expect(results.map((one) => [one.name, one.status])).toEqual([['test_main::T.test_double', 'pass']]);
  });

  it('a project with no framework tests runs none', async () => {
    const results = await runCases(orderOf('python-full', [file('main.py', 'print(1)\n')]), [], true);
    expect(results).toEqual([]);
  });

  it('quick Python has no unittest and says so', async () => {
    const results = await runCases(orderOf('python-quick', [file('main.py', SUITE)]), [], true);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'error' });
    expect(results[0]!.message).toMatch(/full Python/);
  });

  it('JavaScript tests run through the test API: toBeCloseTo passes and toBe fails for 0.1 + 0.2', async () => {
    const text = `test('close', () => { expect(0.1 + 0.2).toBeCloseTo(0.3); });\ntest('exact', () => { expect(0.1 + 0.2).toBe(0.3); });\n`;
    const results = await runCases(orderOf('javascript', [file('main.test.js', text)]), [], true);
    expect(results.map((one) => one.status)).toEqual(['pass', 'fail']);
  });

  it('a stored case and the framework run together, cases first', async () => {
    const text = `${SUITE.slice(0, SUITE.indexOf('if __name__'))}\nprint("hi")\n`;
    const results = await runCases(orderOf('python-full', [file('main.py', text)]), [io('c', '', 'hi')], true);
    expect(results[0]).toMatchObject({ id: 'c', status: 'pass' });
    expect(results).toHaveLength(5);
  });
});

it('the marker is a line of its own', () => {
  expect(CALL_MARKER).toBe('@@OPENNOTE-CALL@@');
  expect(lastCallResult('noise\n@@OPENNOTE-CALL@@[1]\n')).toBe('[1]');
  expect(lastCallResult('noise\n')).toBeNull();
});
