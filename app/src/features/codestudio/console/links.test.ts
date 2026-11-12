// Known answers: the three shapes the lane names, written as CPython's traceback module, GCC, and V8 print them.
import { describe, expect, it } from 'vitest';
import { findLinks, resolvePath } from './links';

const FILES = ['main.py', 'main.cpp', 'main.js', 'src/util.py', 'lib/util.js'];

describe('console links', () => {
  it('links a Python traceback line to the file and line', () => {
    const text = '  File "main.py", line 3, in <module>';
    expect(findLinks(text, FILES)).toEqual([{ start: 2, end: 24, file: 'main.py', line: 3 }]);
    expect(text.slice(2, 24)).toBe('File "main.py", line 3');
  });

  it('links a compiler error with its line and column', () => {
    expect(findLinks('main.cpp:12:5: error: expected ‘;’', FILES)).toEqual([
      { start: 0, end: 13, file: 'main.cpp', line: 12, column: 5 },
    ]);
  });

  it('links a JavaScript stack frame', () => {
    const text = '    at f (main.js:7)';
    expect(findLinks(text, FILES)).toEqual([{ start: 10, end: 19, file: 'main.js', line: 7 }]);
    expect(findLinks('    at main.js:7:3', FILES)).toEqual([
      { start: 7, end: 18, file: 'main.js', line: 7, column: 3 },
    ]);
  });

  it('finds the project file behind an absolute path inside the runtime', () => {
    expect(findLinks('  File "/project/src/util.py", line 9, in f', FILES)[0]).toMatchObject({
      file: 'src/util.py',
      line: 9,
    });
    expect(resolvePath('C:\\work\\lib\\util.js', FILES)).toBe('lib/util.js');
    expect(resolvePath('./main.js', FILES)).toBe('main.js');
  });

  it('makes no link for a file outside the project, a URL, or line 0', () => {
    expect(findLinks('  File "/usr/lib/python3.12/json/__init__.py", line 293', FILES)).toEqual([]);
    expect(findLinks('see https://example.com:443/x', FILES)).toEqual([]);
    expect(findLinks('main.js:0', FILES)).toEqual([]);
  });

  it('links each of several places on one line', () => {
    const links = findLinks('main.py:2 and main.js:4:1', FILES);
    expect(links.map((link) => [link.file, link.line])).toEqual([
      ['main.py', 2],
      ['main.js', 4],
    ]);
  });
});

describe('console links on very long lines', () => {
  // A program can print a line of 100,000 characters (the run's output cap). Each search must stay quick.
  const LONG = 100_000;
  it.each([
    ['letters', 'a'.repeat(LONG)],
    ['letters and dots', 'a.'.repeat(LONG / 2)],
    ['path characters', 'a/b-c.d'.repeat(LONG / 7)],
    ['open quotes', 'File "'.repeat(LONG / 6)],
  ])('searches a line of %s in a bounded time', (_name, text) => {
    const started = performance.now();
    expect(findLinks(text, FILES)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('still links a place at the start of a long line', () => {
    const text = `main.py:4: ${'x'.repeat(LONG)}`;
    expect(findLinks(text, FILES)).toEqual([{ start: 0, end: 9, file: 'main.py', line: 4 }]);
  });
});
