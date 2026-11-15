// Pattern ghost text and explicit requests (DESIGN 10.2, lane code:L12). Expected texts are hand-worked. One is
// the next line of a run with a constant step. Others are the idioms DESIGN 10.2 lists: Python's `__main__` guard,
// the common import aliases, and C's and C++'s first standard header. Explicit requests follow DESIGN 5.3.1.
import { pythonLanguage } from '@codemirror/lang-python';
import { describe, expect, it } from 'vitest';
import { suggest } from './ghost';
import { AUTO_THRESHOLD, EXPLICIT_THRESHOLD, predict } from './pattern';
import { tokenize } from './tokens';

/** The automatic ghost text at the end of `text`. */
const ghost = (language: string, text: string): string | null =>
  predict(language, text, text.length, false)?.text ?? null;

/** What an explicit request inserts at the end of `text`. */
function explicit(language: string, text: string): string | null {
  const tree = language === 'python' ? pythonLanguage.parser.parse(text) : null;
  return suggest({ language, text, pos: text.length, explicit: true }, { tree })?.text ?? null;
}

describe('pattern ghost text', () => {
  it('continues a run of lines with a numeric step', () => {
    const text = 'a1 = x[1]\na2 = x[2]\na';
    expect(`a${ghost('python', text)}`).toBe('a3 = x[3]');
    expect(ghost('python', 'v10 = 10\nv20 = 20\nv30 = 30\nv')).toBe('40 = 40');
  });

  it('completes the __main__ guard', () => {
    expect(ghost('python', 'if __name__ == "')).toBe('__main__":');
    expect(ghost('python', "if __name__ == '")).toBe("__main__':");
  });

  it('proposes the usual import aliases', () => {
    expect(ghost('python', 'import numpy as ')).toBe('np');
    expect(ghost('python', 'import numpy as')).toBe(' np');
    expect(ghost('python', 'import pandas as ')).toBe('pd');
    expect(ghost('python', 'import matplotlib.pyplot as ')).toBe('plt');
  });

  it('proposes the first standard header for C and C++', () => {
    expect(ghost('cpp', '#include <')).toBe('iostream>');
    expect(ghost('c', '#include <')).toBe('stdio.h>');
  });

  it('closes main and counted loops', () => {
    expect(ghost('c', 'int main(')).toBe('void) {');
    expect(ghost('java', 'public static void main(')).toBe('String[] args) {');
    expect(ghost('cpp', 'int n = 5;\nfor (int i = 0; i < ')).toBe('n; i++) {');
    expect(ghost('cpp', 'for (size_t k = 0; k < ')).toBeNull();
    expect(predict('cpp', 'for (size_t k = 0; k < ', 23, true)?.text).toBe('n; k++) {');
  });

  it('closes a def line with a colon', () => {
    expect(ghost('python', 'def area(radius)')).toBe(':');
    expect(ghost('python', 'def area(radius')).toBeNull();
  });

  it('reuses an earlier line with the same start', () => {
    const text = 'print("total:", total, sep="")\nx = 1\nprint("total:", ';
    expect(ghost('python', text)).toBe('total, sep="")');
  });

  it('keeps nested brackets and strings when the editor already typed the closer', () => {
    const text = 'print("total:", foo(total), sep="")\nx = 1\nprint("total:", )';
    expect(predict('python', text, text.length - 1, false)?.text).toBe('foo(total), sep=""');
    const listed = 'rows.append([a[0], b])\nrows.append([])';
    expect(predict('python', listed, listed.length - 2, true)?.text).toBe('a[0], b');
  });

  it('keeps padded widths and never steps below zero or past exact integers', () => {
    expect(ghost('python', 'img01 = load(1)\nimg02 = load(2)\nimg')).toBe('03 = load(3)');
    expect(ghost('python', 'a1 = 1\na0 = 0\na')).toBeNull();
    const huge = 'n = 9007199254740990\nn = 9007199254740991\nn';
    expect(ghost('python', huge)).toBeNull();
  });

  it('tokenizes digits outside ASCII as single characters, so a line rebuilds exactly', () => {
    const line = 'x² = ٣ + ①';
    expect(
      tokenize(line)
        .map((token) => token.text)
        .join(''),
    ).toBe(line);
  });

  it('stops before a closer the editor already typed', () => {
    const text = 'if __name__ == ""';
    expect(predict('python', text, text.length - 1, false)?.text).toBe('__main__');
  });

  it('shows nothing mid-line, on a new line, or below the threshold', () => {
    expect(predict('python', 'import numpy as x', 15, false)).toBeNull();
    expect(ghost('python', 'def f():\n    ')).toBeNull();
    expect(ghost('python', 'total = 0\ntot')).toBeNull();
    expect(EXPLICIT_THRESHOLD).toBeLessThan(AUTO_THRESHOLD);
  });

  it('keeps every suggestion to one line', () => {
    for (const text of ['a1 = x[1]\na2 = x[2]\na', 'if __name__ == "', '#include <']) {
      expect(ghost(text.startsWith('#') ? 'c' : 'python', text)).not.toContain('\n');
    }
  });
});

describe('ghost text guards', () => {
  it('closes a signature only when its brackets and strings are balanced', () => {
    expect(ghost('python', 'def f(a, b=(1, 2))')).toBe(':');
    expect(ghost('python', 'class A(B())')).toBe(':');
    expect(ghost('python', 'def f(a) -> list[int]')).toBe(':');
    expect(ghost('python', 'def f(a) -> None')).toBe(':');
    expect(ghost('python', 'def f(a=(1, 2)')).toBeNull();
    // The editor already closed the `)` after the caret.
    expect(predict('python', 'def f(x=g())', 'def f(x=g()'.length, false)).toBeNull();
    expect(predict('python', 'class A(B())', 'class A(B()'.length, false)).toBeNull();
    expect(ghost('python', 'def f(a, b="x)')).toBeNull();
    expect(ghost('python', 'def f(a=lambda: g()')).toBeNull();
    expect(ghost('python', 'def f(a)  # note (x)')).toBeNull();
    expect(ghost('python', 'def f(a):')).toBeNull();
    // The caret may still be typing the annotation; an explicit request still offers the colon.
    expect(ghost('python', 'def f(a) -> tup')).toBeNull();
    expect(predict('python', 'def f(a) -> tup', 15, true)?.text).toBe(':');
  });

  it('does not step hex digits as decimal or step past zero after a minus', () => {
    expect(ghost('python', 'v = -2\nv = -1\nv')).toBeNull();
    expect(ghost('python', 'v = -3\nv = -2\nv')).toBe(' = -1');
    expect(ghost('c', 'a = 0x08;\na = 0x09;\na')).toBeNull();
  });

  it('does not fire idioms inside a string or a comment', () => {
    expect(ghost('python', 'x = "if __name__ == "')).toBeNull();
    expect(ghost('cpp', '// for (int i = 0; i < ')).toBeNull();
    expect(ghost('cpp', '// int main(')).toBeNull();
    expect(ghost('sql', 'CREATE TABLE t (a INT);\n-- SELECT * FROM ')).toBeNull();
    expect(ghost('sql', "CREATE TABLE t (a INT);\nSELECT 'x FROM ")).toBeNull();
    expect(ghost('sql', 'CREATE TABLE t (a INT);\nSELECT * FROM ')).toBe('t');
  });

  it('treats a language named like an object key as unknown', () => {
    for (const language of ['constructor', 'toString', '__proto__']) {
      expect(() => predict(language, 'x = 1\nx', 7, true)).not.toThrow();
    }
  });
});

describe('explicit requests', () => {
  it('inserts the leading list item where the automatic predictor shows nothing', () => {
    const text = 'total = 0\nfor n in nums:\n    tot';
    expect(ghost('python', text)).toBeNull();
    expect(explicit('python', text)).toBe('al');
  });

  it('returns nothing on a blank line in an empty file', () => {
    expect(explicit('python', '')).toBeNull();
  });

  it('uses the pattern predictor first, at its lower threshold', () => {
    // Two complete tokens are below the automatic threshold and above the explicit one.
    const text = 'print("a")\nprint(';
    expect(ghost('python', text)).toBeNull();
    expect(explicit('python', text)).toBe('"a")');
  });
});
