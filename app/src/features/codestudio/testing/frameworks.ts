// Framework adapters (DESIGN 9.2): the tests a language's own framework finds in the code.
// - Python (full runtime): `unittest`, through a harness that sends one marker line per test.
// - JavaScript and TypeScript: the Jest-style API of code:L06 reports through `test` messages by itself.
// - C and C++: a failed `assert` is read from the program's error output, with file and line.
// R2 adds pytest through junitxml and gutter markers on test functions.
import type { RunFile, RuntimeId, TestResult, TestStatus } from '../contracts';
import { HARNESS_FILE, folderOf, pythonLoad } from './harness';

export const TEST_MARKER = '@@OPENNOTE-TEST@@';

const PYTHON_TEST_FILE = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/;
const JS_TEST_FILE = /\.(test|spec)\.[cm]?[jt]s$/;

/** True when the project holds tests of the runtime's own framework, so a "Run tests" has something to find. */
export function hasFrameworkTests(runtime: RuntimeId, files: RunFile[]): boolean {
  switch (runtime) {
    case 'python-full':
    case 'python-quick':
      return files.some((file) => PYTHON_TEST_FILE.test(file.path) || /\bunittest\b/.test(file.text));
    case 'javascript':
    case 'typescript':
      return files.some(
        (file) => JS_TEST_FILE.test(file.path) || /(^|\n)\s*(describe|test|it)(\.\w+)?\s*\(/.test(file.text),
      );
    case 'c':
    case 'cpp':
      return files.some((file) => /\bassert\s*\(/.test(file.text));
    default:
      return false;
  }
}

/** The module names of the project's other Python test files (`tests/test_a.py` is `tests.test_a`). */
export function pythonTestModules(files: RunFile[], main: string): string[] {
  return files
    .filter((file) => file.path !== main && PYTHON_TEST_FILE.test(file.path))
    .map((file) => file.path.replace(/\.py$/, '').replace(/\//g, '.'));
}

const PYTHON_RUNNER = `
import unittest as _on_unittest
import time as _on_time
import types as _on_types


def _on_where(tb):
    found = None
    while tb is not None:
        name = tb.tb_frame.f_code.co_filename
        if 'unittest' not in name and not name.startswith('/lib'):
            found = (name, tb.tb_lineno)
        tb = tb.tb_next
    return found


class _OnResult(_on_unittest.TestResult):
    def _on_name(self, test):
        name = type(test).__name__ + '.' + getattr(test, '_testMethodName', 'test')
        module = type(test).__module__
        return name if module == 'opennote_user' else module + '::' + name

    def _on_emit(self, test, status, err=None):
        found = None
        message = ''
        if err is not None:
            lines = str(err[1]).strip().splitlines()
            message = (lines[0] if lines else '') or err[0].__name__
            found = _on_where(err[2])
        item = {'name': self._on_name(test), 'status': status, 'message': message,
                'timeMs': int((_on_time.time() - self._on_t0) * 1000)}
        if found is not None:
            item['file'] = found[0].replace('/project/', '', 1)
            item['line'] = found[1]
        print(${JSON.stringify(TEST_MARKER)} + _on_json.dumps(item))

    def startTest(self, test):
        _on_unittest.TestResult.startTest(self, test)
        self._on_t0 = _on_time.time()

    def addSuccess(self, test):
        _on_unittest.TestResult.addSuccess(self, test)
        self._on_emit(test, 'pass')

    def addFailure(self, test, err):
        _on_unittest.TestResult.addFailure(self, test, err)
        self._on_emit(test, 'fail', err)

    def addError(self, test, err):
        _on_unittest.TestResult.addError(self, test, err)
        self._on_emit(test, 'error', err)

    def addSkip(self, test, reason):
        _on_unittest.TestResult.addSkip(self, test, reason)
        self._on_emit(test, 'skipped')


_on_module = _on_types.ModuleType('opennote_user')
_on_module.__dict__.update(_on_scope)
_on_loader = _on_unittest.TestLoader()
_on_suite = _on_loader.loadTestsFromModule(_on_module)
for _on_name in _on_json.loads(_on_modules):
    _on_suite.addTests(_on_loader.loadTestsFromName(_on_name))
_on_suite.run(_OnResult())
`;

/** The Python file that runs the main file's `unittest` tests and the other test files', one marker line per test. */
export function unittestHarness(files: RunFile[], main: string): { path: string; text: string } {
  const modules = JSON.stringify(pythonTestModules(files, main));
  return {
    path: `${folderOf(main)}${HARNESS_FILE}.py`,
    text: `import json as _on_json\n${pythonLoad(main)}_on_modules = ${JSON.stringify(modules)}\n${PYTHON_RUNNER}`,
  };
}

const STATUSES = new Set<TestStatus>(['pass', 'fail', 'error', 'time', 'skipped']);

/** The results in a program's output: the marker lines, in order. Lines that are not valid are ignored. */
export function readTestResults(stdout: string): TestResult[] {
  const results: TestResult[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(TEST_MARKER)) continue;
    try {
      const item = JSON.parse(line.slice(TEST_MARKER.length)) as Record<string, unknown>;
      if (typeof item.name !== 'string' || !STATUSES.has(item.status as TestStatus)) continue;
      const result: TestResult = {
        id: `framework::${item.name}`,
        name: item.name,
        status: item.status as TestStatus,
        timeMs: typeof item.timeMs === 'number' ? item.timeMs : 0,
      };
      if (typeof item.message === 'string' && item.message) result.message = item.message;
      if (typeof item.file === 'string' && typeof item.line === 'number')
        result.location = { file: item.file, line: item.line };
      results.push(result);
    } catch {
      // A line that only looks like a result.
    }
  }
  return results;
}

/** Program output with the harness's marker lines taken out, for the console. */
export const withoutMarkers = (text: string) =>
  text
    .split('\n')
    .filter((line) => !line.startsWith(TEST_MARKER))
    .join('\n');

// --- C and C++.

export interface AssertFailure {
  expression: string;
  file: string;
  line: number;
}

// glibc: "prog: main.c:12: main: Assertion `x == 1' failed."
// musl and wasi-libc: "Assertion failed: x == 1 (main.c: main: 12)"
// Apple and MSVC: "Assertion failed: (x == 1), function main, file main.c, line 12." and "Assertion failed: x == 1, file main.c, line 12"
const ASSERT_FORMATS: RegExp[] = [
  /^(?:[^\s:]+: )?([^\s:]+):(\d+): (?:[\w:]+: )?Assertion [`'"](.+)['"] failed\.?$/,
  /^Assertion failed: (.+) \(([^:()]+): [^:()]*: (\d+)\)$/,
  /^Assertion failed: \(?(.+?)\)?, (?:function [^,]+, )?file ([^,]+), line (\d+)\.?$/,
];

/** The failed assertions in a C or C++ program's error output. */
export function parseAssertFailures(stderr: string): AssertFailure[] {
  const found: AssertFailure[] = [];
  for (const raw of stderr.split(/\r?\n/)) {
    const text = raw.trim();
    const glibc = ASSERT_FORMATS[0]!.exec(text);
    if (glibc) {
      found.push({ file: glibc[1]!, line: Number(glibc[2]), expression: glibc[3]! });
      continue;
    }
    const musl = ASSERT_FORMATS[1]!.exec(text);
    if (musl) {
      found.push({ expression: musl[1]!, file: musl[2]!, line: Number(musl[3]) });
      continue;
    }
    const apple = ASSERT_FORMATS[2]!.exec(text);
    if (apple) found.push({ expression: apple[1]!, file: apple[2]!.trim(), line: Number(apple[3]) });
  }
  return found;
}
