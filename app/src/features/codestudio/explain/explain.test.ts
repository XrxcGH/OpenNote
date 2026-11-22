// The explanation catalog (DESIGN 7.2, lane code:L11). Every entry carries messages the runtime or compiler really
// prints. A pattern that drifts away from them, or an entry without words, fails here.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainEntries } from '../../../strings/en/codeStudio/explainEntries';
import { PYTHON_BUILTINS } from '../diagnostics/pythonNames';
import { CATALOG, cleanMessage, explain, fixArticles, indexHint, type ExplainLanguage } from './index';
import { CLANG_ENTRIES } from './clang';

const LANGUAGES: ExplainLanguage[] = ['python', 'javascript', 'c', 'sql', 'lua'];

describe('catalog entries', () => {
  it('has words for every entry and an entry for every set of words', () => {
    const ids = LANGUAGES.flatMap((l) => CATALOG[l].map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(explainEntries).sort());
  });

  for (const language of LANGUAGES) {
    it(`${language}: each real message matches its own entry first`, () => {
      for (const { id, samples } of CATALOG[language]) {
        expect(samples.length, id).toBeGreaterThan(0);
        for (const sample of samples) expect(explain({ language, message: sample }).id, `${id}: ${sample}`).toBe(id);
      }
    });

    it(`${language}: every explanation is a full sentence set with no leftover placeholders`, () => {
      for (const { id, samples } of CATALOG[language]) {
        const found = explain({ language, message: samples[0]! });
        for (const text of [found.what, found.cause, found.next]) {
          expect(text, id).toMatch(/\S/);
          expect(text, id).not.toMatch(/\{[A-Za-z]\w*\}/);
          expect(text, id).toMatch(/[.)]$/);
        }
      }
    });
  }

  it('covers the 60 most common clang diagnostics', () => {
    expect(CLANG_ENTRIES.length).toBeGreaterThanOrEqual(60);
  });

  it('explains every concrete exception class of CPython 3.12', () => {
    const concrete = [...PYTHON_BUILTINS].filter(
      (name) =>
        /^[A-Z]\w*(?:Error|Exception|Exit|Interrupt|Iteration)$/.test(name) &&
        !/^(?:BaseExceptionGroup|ExceptionGroup|PythonFinalizationError)$/.test(name),
    );
    expect(concrete.length).toBeGreaterThan(30);
    for (const name of concrete) {
      expect(explain({ language: 'python', message: `${name}: example` }).id, name).not.toBeNull();
    }
  });
});

describe('messages the runtimes printed in their own suites', () => {
  it('matches Python 3.12 output', () => {
    const captured: [string, string][] = [
      ["NameError: name 'pritn' is not defined. Did you mean: 'print'?", 'pyNameNotDefined'],
      ["NameError: name 'math' is not defined. Did you forget to import 'math'?", 'pyNameNotDefined'],
      ["SyntaxError: expected ':'", 'pySyntaxColon'],
      ['EOFError: EOF when reading a line', 'pyEofInput'],
      ['ValueError: bad', 'pyClassValueError'],
      ['SyntaxError: invalid syntax', 'pySyntaxInvalid'],
    ];
    for (const [message, id] of captured) expect(explain({ language: 'python', message }).id).toBe(id);
  });

  it('matches QuickJS and V8 output', () => {
    const captured: [string, string][] = [
      ['InternalError: out of memory', 'jsClassError'],
      ['RangeError: late', 'jsClassRangeError'],
      ['Error: setup', 'jsClassError'],
      ['TypeError: b', 'jsClassTypeError'],
      ['SyntaxError: Unexpected token', 'jsUnexpectedToken'],
    ];
    for (const [message, id] of captured) {
      const found = explain({ language: 'javascript', message }).id;
      expect(found, message).toBe(id);
    }
  });
});

describe('explain', () => {
  it('quotes the failing line and fills in the names', () => {
    const found = explain({
      language: 'python',
      message:
        'Traceback (most recent call last):\n  File "main.py", line 2, in <module>\nNameError: name \'totl\' is not defined',
      line: 2,
      lineText: '    print(totl)  ',
    });
    expect(found.id).toBe('pyNameNotDefined');
    expect(found.what).toBe('The name totl does not exist.');
    expect(found.quote).toBe('Line 2: print(totl)');
    expect(found.raw).toBe("NameError: name 'totl' is not defined");
    expect(found.next).toContain('totl');
  });

  it('gives a generic explanation and the raw message for an unknown error', () => {
    const found = explain({ language: 'python', message: 'Weird: nothing like it' });
    expect(found.id).toBeNull();
    expect(found.what).toBe('This error is not in the catalog yet.');
    expect(found.raw).toBe('Weird: nothing like it');
  });

  it('cleans compiler and runtime decoration', () => {
    expect(cleanMessage('c', "main.c:3:5: error: use of undeclared identifier 'x' [-Wundeclared]")).toBe(
      "use of undeclared identifier 'x'",
    );
    expect(cleanMessage('c', "main.c:3:5: fatal error: 'foo.h' file not found")).toBe("'foo.h' file not found");
    expect(cleanMessage('lua', "main.lua:4: attempt to call a nil value (global 'prnt')")).toBe(
      "attempt to call a nil value (global 'prnt')",
    );
    expect(cleanMessage('sql', 'Error: no such table: users')).toBe('no such table: users');
    expect(explain({ language: 'sql', message: 'SQLITE_ERROR: no such column: nmae' }).id).toBe('sqNoColumn');
    expect(explain({ language: 'c', message: "a.c:1:1: warning: unused variable 'n' [-Wunused-variable]" }).id).toBe(
      'clUnusedVariable',
    );
  });

  it('shows the length and the index of an IndexError from the trace', () => {
    const found = explain({
      language: 'python',
      message: 'IndexError: list index out of range',
      hints: { index: 5, length: 3 },
    });
    expect(found.hint).toBe(
      'The sequence has 3 items, so the valid positions are 0 to 2. The code asked for position 5. ' +
        'In a loop, range(len(x)) is right and range(len(x) + 1) goes one too far.',
    );
    expect(indexHint({ index: 3, length: 3 })).toContain('one past the last item');
    expect(indexHint({ index: -4, length: 3 })).toContain('lowest valid one is -3');
    expect(indexHint({ index: 0, length: 0 })).toContain('is empty');
    expect(indexHint({ index: 1 })).toBeUndefined();
    expect(explain({ language: 'python', message: 'IndexError: list index out of range' }).hint).toBeUndefined();
  });
});

describe('output captured from the real runtimes', () => {
  // runtimeCapture.json holds what CPython and SQLite printed for deliberately failing snippets (CPython 3.14.6 and
  // SQLite 3.50.4 through their standard Python modules). The Pyodide pack runs CPython 3.12, whose wording is the same
  // for these classes. A pattern that drifts from the runtimes fails here.
  const captured = JSON.parse(readFileSync(new URL('./runtimeCapture.json', import.meta.url), 'utf8')) as {
    python: string[];
    sqlite: string[];
  };

  it('explains every message CPython printed', () => {
    for (const message of captured.python) {
      expect(explain({ language: 'python', message }).id, message).not.toBeNull();
    }
  });

  it('explains every message SQLite printed', () => {
    for (const message of captured.sqlite) {
      expect(explain({ language: 'sql', message }).id, message).not.toBeNull();
    }
  });

  it('knows the InternalError of QuickJS', () => {
    expect(explain({ language: 'javascript', message: 'InternalError: out of memory' }).id).toBe('jsClassError');
  });

  it('writes "An int", not "A int"', () => {
    const e = explain({ language: 'python', message: "TypeError: 'int' object is not subscriptable" });
    expect(`${e.what} ${e.cause}`).not.toMatch(/\bA int\b/);
    expect(e.what).toMatch(/^An int/);
    expect(fixArticles('A user, A union, A one, A string, A object')).toBe(
      'A user, A union, A one, A string, An object',
    );
  });
});

describe('review gaps, second round', () => {
  const captured = JSON.parse(readFileSync(new URL('./runtimeCapture.json', import.meta.url), 'utf8')) as {
    javascript: string[];
    lua: string[];
  };
  // Messages QuickJS 0.32.0 (the app's engine) and Lua 5.4 (wasmoon) really printed.
  const specific: Record<string, string> = {
    "TypeError: cannot read property 'x' of undefined": 'jsReadUndefined',
    "TypeError: cannot read property 'x' of null": 'jsReadUndefined',
    "TypeError: cannot set property 'x' of undefined": 'jsSetUndefined',
    'TypeError: not a function': 'jsNotFunctionAnon',
    "TypeError: 'c' is read-only": 'jsConstAssign',
    'TypeError: cannot convert to object': 'jsConvertObject',
    'TypeError: not a constructor': 'jsNotConstructorAnon',
    "TypeError: class constructors must be invoked with 'new'": 'jsClassNewAnon',
    'RangeError: invalid array length': 'jsArrayLength',
    "ReferenceError: 'foo' is not defined": 'jsNotDefined',
  };

  it('names the specific entry for every captured QuickJS message', () => {
    for (const message of captured.javascript) {
      const want = specific[message];
      if (want) expect(explain({ language: 'javascript', message }).id, message).toBe(want);
      else expect(explain({ language: 'javascript', message }).id, message).not.toBeNull();
    }
    expect(Object.keys(specific).every((m) => captured.javascript.includes(m))).toBe(true);
  });

  it('fills the name from the QuickJS wording', () => {
    const e = explain({ language: 'javascript', message: "TypeError: cannot read property 'x' of undefined" });
    expect(e.what).toBe('The code reads x from undefined.');
  });

  it('explains every message Lua printed', () => {
    for (const message of captured.lua) expect(explain({ language: 'lua', message }).id, message).not.toBeNull();
  });

  it('answers a hostile message in bounded time, in every language', () => {
    const hostile = [
      `Error: ${' '.repeat(200_000)}`,
      `error: ${'a '.repeat(100_000)}`,
      `TypeError: ${'('.repeat(100_000)}`,
      `${'x'.repeat(100_000)}:1:${' '.repeat(100_000)}`,
    ];
    for (const language of ['python', 'javascript', 'c', 'cpp', 'sql', 'lua'] as const) {
      for (const message of hostile) {
        const start = performance.now();
        explain({ language, message });
        expect(performance.now() - start, `${language} ${message.slice(0, 12)}`).toBeLessThan(500);
      }
    }
  });
});
