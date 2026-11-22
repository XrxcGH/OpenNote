// The explanation catalog (DESIGN 7.2, lane code:L11). Every entry carries messages the runtime or compiler really
// prints. A pattern that drifts away from them, or an entry without words, fails here.

import { describe, expect, it } from 'vitest';
import { codeStudioExplain } from '../../../strings/en/codeStudio/explain';
import { PYTHON_BUILTINS } from '../diagnostics/pythonNames';
import { CATALOG, cleanMessage, explain, indexHint, type ExplainLanguage } from './index';
import { CLANG_ENTRIES } from './clang';

const LANGUAGES: ExplainLanguage[] = ['python', 'javascript', 'c', 'sql', 'lua'];

describe('catalog entries', () => {
  it('has words for every entry and an entry for every set of words', () => {
    const ids = LANGUAGES.flatMap((l) => CATALOG[l].map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(codeStudioExplain.entries).sort());
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
      // QuickJS names its own InternalError, which the catalog does not know.
      expect(found, message).toBe(message.startsWith('InternalError') ? null : id);
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
