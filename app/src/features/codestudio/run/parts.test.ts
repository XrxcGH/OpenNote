// The parts a run worker hands its adapter: standard input (DESIGN 4.4), the project mount and its write overlay
// (DESIGN 4.3), the seeded random source (DESIGN 4.5), and diagnostic mapping (DESIGN 4.6).

import { describe, expect, it } from 'vitest';
import { patternMapper, mapDiagnostics } from './diagnostics';
import { Mount, normalPath } from './mount';
import { seeded, xorshift32 } from './random';
import { Stdin, jspiAvailable } from './stdin';

describe('standard input', () => {
  it('gives a program reading three lines each in order, then EOF', () => {
    const stdin = new Stdin('first\nsecond\r\nthird\n', false);
    expect([stdin.line(), stdin.line(), stdin.line()]).toEqual(['first', 'second', 'third']);
    expect(stdin.askedPastEnd).toBe(false);
    expect(stdin.line()).toBeNull();
    expect(stdin.askedPastEnd).toBe(true);
  });

  it('reads a last line without a line break, and reads by count', () => {
    const stdin = new Stdin('ab\ncd', false);
    expect(stdin.read(1)).toBe('a');
    expect(stdin.line()).toBe('b');
    expect(stdin.read()).toBe('cd');
    expect(stdin.read()).toBeNull();
  });

  it('asks the page after the prefilled text in interactive mode, and takes its end of input', async () => {
    const asked: string[] = [];
    const replies = ['typed\n', null];
    const stdin = new Stdin('given\n', true, async (prompt) => {
      asked.push(prompt);
      return replies.shift() ?? null;
    });
    expect(await stdin.lineAsync('> ')).toBe('given');
    expect(await stdin.lineAsync('> ')).toBe('typed');
    expect(await stdin.lineAsync('> ')).toBeNull();
    expect(await stdin.lineAsync('> ')).toBeNull();
    expect(asked).toEqual(['> ', '> ']);
    // The person ended the input, so the console does not say the program wanted more.
    expect(stdin.askedPastEnd).toBe(false);
  });

  it('reads only the prefilled text when not interactive', async () => {
    const stdin = new Stdin('one', false, () => Promise.reject(new Error('asked')));
    expect(await stdin.lineAsync('')).toBe('one');
    expect(await stdin.lineAsync('')).toBeNull();
    expect(stdin.askedPastEnd).toBe(true);
  });

  it('finds JSPI only when both of its entry points exist', () => {
    expect(jspiAvailable({})).toBe(false);
    expect(jspiAvailable({ Suspending: function () {} })).toBe(false);
    expect(jspiAvailable({ Suspending: function () {}, promising: () => undefined })).toBe(true);
  });
});

describe('the project mount', () => {
  it('reads project files and keeps writes in an overlay', () => {
    const mount = new Mount([{ path: 'data/in.txt', text: '1 2 3' }]);
    expect(mount.read('./data/in.txt')).toBe('1 2 3');
    expect(mount.write('data/in.txt', 'changed')).toBe(true);
    expect(mount.write('out.txt', 'result')).toBe(true);
    expect(mount.read('data/in.txt')).toBe('changed');
    expect(mount.paths()).toEqual(['data/in.txt', 'out.txt']);
    expect(mount.written()).toEqual([
      { path: 'data/in.txt', text: 'changed' },
      { path: 'out.txt', text: 'result' },
    ]);
  });

  it('keeps writes inside the project and its limits', () => {
    const mount = new Mount([]);
    expect(mount.write('../escape.txt', 'x')).toBe(false);
    expect(mount.write('C:/Windows/x.txt', 'x')).toBe(false);
    expect(mount.write('big.txt', 'x'.repeat(1024 * 1024 + 1))).toBe(false);
    expect(mount.read('/etc/passwd')).toBeNull();
    expect(normalPath('a//b/./c.txt')).toBe('a/b/c.txt');
    expect(normalPath('a/../b')).toBeNull();
  });
});

describe('seeded randomness', () => {
  it('follows xorshift32 with shifts 13, 17, 5, worked by hand for seed 1', () => {
    // x = 1; x ^= x << 13 gives 8193; x ^= x >>> 17 leaves 8193; x ^= x << 5 gives 8193 ^ 262176 = 270369.
    expect(xorshift32(1)()).toBe(270369);
  });

  it('gives the same sequence for the same seed and another for another seed', () => {
    const a = seeded(42);
    const b = seeded(42);
    const c = seeded(43);
    const first = Array.from({ length: 5 }, () => a.random());
    expect(Array.from({ length: 5 }, () => b.random())).toEqual(first);
    expect(Array.from({ length: 5 }, () => c.random())).not.toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(seeded(0).random()).toBe(seeded(1).random());
  });

  it('fills bytes from the same sequence', () => {
    const bytes = new Uint8Array(6);
    seeded(1).fill(bytes);
    // 270369 is 0x00042021, sent low byte first.
    expect([...bytes.slice(0, 4)]).toEqual([0x21, 0x20, 0x04, 0x00]);
  });
});

describe('diagnostic mapping', () => {
  const files = [
    { path: 'main.py', text: 'a\nb\nc\nd' },
    { path: 'lib/util.c', text: 'x\ny' },
  ];
  const python = patternMapper([{ pattern: /File "(?<file>[^"]+)", line (?<line>\d+)/, fallbackKind: 'error' }]);
  const clang = patternMapper([
    {
      pattern: /^(?<file>[^:\n]+):(?<line>\d+):(?<column>\d+): (?<kind>error|warning): (?<message>.*)$/m,
      fallbackKind: 'error',
    },
  ]);

  it('maps a CPython traceback to project lines and skips the runtime’s own frames', () => {
    const text = [
      'Traceback (most recent call last):',
      '  File "main.py", line 3, in <module>',
      '  File "/lib/python3.14/x.py", line 9, in f',
      'NameError: name "q" is not defined',
    ].join('\n');
    expect(python.map(text, files)).toEqual([
      { file: 'main.py', line: 3, message: 'File "main.py", line 3', kind: 'error' },
    ]);
  });

  it('maps clang errors with column, kind, and message, and moves a line past the end to the last', () => {
    const text = "lib/util.c:2:5: error: use of undeclared identifier 'z'\nlib/util.c:9:1: warning: no newline\n";
    expect(clang.map(text, files)).toEqual([
      { file: 'lib/util.c', line: 2, column: 5, message: "use of undeclared identifier 'z'", kind: 'error' },
      { file: 'lib/util.c', line: 2, column: 1, message: 'no newline', kind: 'warning' },
    ]);
  });

  it('reports nothing from a mapper that throws', () => {
    const broken = {
      map: () => {
        throw new Error('bad');
      },
    };
    expect(mapDiagnostics(broken, 'x', files)).toEqual([]);
    expect(mapDiagnostics(undefined, 'x', files)).toEqual([]);
  });
});
