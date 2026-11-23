// Framework adapter parts that need no runtime: reading a failed C assert in each libc's documented format, reading
// result lines, and telling whether a project holds framework tests.
import { describe, expect, it } from 'vitest';
import { hasFrameworkTests, parseAssertFailures, pythonTestModules, readTestResults, TEST_MARKER } from './frameworks';

describe('C and C++ assert reports', () => {
  it('reads the glibc format', () => {
    expect(parseAssertFailures("a.out: main.c:12: main: Assertion `x == 1' failed.\nAborted")).toEqual([
      { file: 'main.c', line: 12, expression: 'x == 1' },
    ]);
  });

  it('reads the musl and wasi-libc format', () => {
    expect(parseAssertFailures('Assertion failed: n > 0 (main.cpp: check: 7)')).toEqual([
      { file: 'main.cpp', line: 7, expression: 'n > 0' },
    ]);
  });

  it('reads the BSD and Apple format, with and without the function', () => {
    expect(parseAssertFailures('Assertion failed: (x == 1), function main, file main.c, line 12.')).toEqual([
      { file: 'main.c', line: 12, expression: 'x == 1' },
    ]);
    expect(parseAssertFailures('Assertion failed: x == 1, file main.c, line 3')).toEqual([
      { file: 'main.c', line: 3, expression: 'x == 1' },
    ]);
  });

  it('ignores other output', () => {
    expect(parseAssertFailures('warning: unused variable\nhello')).toEqual([]);
  });
});

describe('result lines', () => {
  it('reads valid lines in order and skips the others', () => {
    const out = [
      'noise',
      `${TEST_MARKER}{"name":"A.test_a","status":"pass","timeMs":3}`,
      `${TEST_MARKER}{"name":"A.test_b","status":"fail","message":"1 != 2","file":"main.py","line":11,"timeMs":1}`,
      `${TEST_MARKER}{"name":"A.test_c","status":"bogus"}`,
      `${TEST_MARKER}not json`,
    ].join('\n');
    expect(readTestResults(out)).toEqual([
      { id: 'framework::A.test_a', name: 'A.test_a', status: 'pass', timeMs: 3 },
      {
        id: 'framework::A.test_b',
        name: 'A.test_b',
        status: 'fail',
        timeMs: 1,
        message: '1 != 2',
        location: { file: 'main.py', line: 11 },
      },
    ]);
  });
});

describe('finding framework tests', () => {
  const file = (path: string, text = '') => ({ path, text });

  it('python: a test file or unittest in the code', () => {
    expect(hasFrameworkTests('python-full', [file('main.py', 'print(1)')])).toBe(false);
    expect(hasFrameworkTests('python-full', [file('main.py', 'import unittest')])).toBe(true);
    expect(hasFrameworkTests('python-full', [file('tests/test_a.py')])).toBe(true);
    expect(hasFrameworkTests('python-full', [file('a_test.py')])).toBe(true);
  });

  it('javascript: a test file or describe, test, or it at the start of a line', () => {
    expect(hasFrameworkTests('javascript', [file('main.js', 'console.log(1)')])).toBe(false);
    expect(hasFrameworkTests('javascript', [file('a.spec.ts')])).toBe(true);
    expect(hasFrameworkTests('javascript', [file('main.js', 'x();\ntest("a", () => {});')])).toBe(true);
    expect(hasFrameworkTests('javascript', [file('main.js', 'const latest = 1;')])).toBe(false);
  });

  it('c: an assert call', () => {
    expect(hasFrameworkTests('c', [file('main.c', 'assert(x == 1);')])).toBe(true);
    expect(hasFrameworkTests('c', [file('main.c', 'int main(){}')])).toBe(false);
  });

  it('lists the other Python test modules as dotted names', () => {
    expect(
      pythonTestModules([file('main.py'), file('test_main.py'), file('tests/test_b.py'), file('util.py')], 'main.py'),
    ).toEqual(['test_main', 'tests.test_b']);
  });
});
