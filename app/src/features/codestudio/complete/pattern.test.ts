// Pattern ghost text and explicit requests (DESIGN 10.2, lane code:L12). Expected texts are hand-worked. One is
// the next line of a run with a constant step. Others are the idioms DESIGN 10.2 lists: Python's `__main__` guard,
// the common import aliases, and C's and C++'s first standard header. Explicit requests follow DESIGN 5.3.1.
import { pythonLanguage } from '@codemirror/lang-python';
import { describe, expect, it } from 'vitest';
import { suggest } from './ghost';
import { AUTO_THRESHOLD, EXPLICIT_THRESHOLD, predict } from './pattern';

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
