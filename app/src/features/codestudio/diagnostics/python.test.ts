// Ruff-parity known answers (ADR 0074): each input is the example in Ruff's documentation of that rule, and the
// expected line is the line Ruff's example marks. The checker must give the same code on the same line.

import { parser } from '@lezer/python';
import { describe, expect, it } from 'vitest';
import { checkPython } from './python';
import { lineAt, lineStarts } from './text';

function lines(source: string, code: string): number[] {
  const starts = lineStarts(source);
  return checkPython(source, parser.parse(source))
    .filter((f) => f.code === code)
    .map((f) => lineAt(starts, f.from));
}

const RUFF_EXAMPLES: { code: string; source: string; lines: number[] }[] = [
  // F401 unused-import: "import numpy as np  # unused import".
  {
    code: 'F401',
    source: 'import numpy as np  # unused import\n\n\ndef area(radius):\n    return 3.14 * radius**2\n',
    lines: [1],
  },
  // F811 redefined-while-unused: the third line redefines `foo` from line 1.
  {
    code: 'F811',
    source: 'import foo\nimport bar\nimport foo  # Redefinition of unused `foo` from line 1\n',
    lines: [3],
  },
  // F821 undefined-name: `n` is never defined.
  {
    code: 'F821',
    source: 'def double():\n    return n * 2  # raises `NameError` if `n` is undefined when `double` is called\n',
    lines: [2],
  },
  // F841 unused-variable: `y` is assigned and never read.
  { code: 'F841', source: 'def foo():\n    x = 1\n    y = 2\n    return x\n', lines: [3] },
  // E711 none-comparison: both comparisons to None.
  { code: 'E711', source: 'if arg != None:\n    pass\nif None == arg:\n    pass\n', lines: [1, 3] },
  // E712 true-false-comparison.
  { code: 'E712', source: 'if foo == True:\n    ...\n\nif bar == False:\n    ...\n', lines: [1, 4] },
  // F632 is-literal.
  { code: 'F632', source: 'x = 200\nif x is 200:\n    print("It\'s 200!")\n', lines: [2] },
  // W191 tab-indentation.
  { code: 'W191', source: 'if True:\n\ta = 1\n', lines: [2] },
  // E101 mixed-spaces-and-tabs: spaces set the file's indent, so the tab line is mixed.
  { code: 'E101', source: 'if a == 0:\n        a = 1\n\tb = 1\n', lines: [3] },
];

describe('Python checker: Ruff documentation examples', () => {
  for (const example of RUFF_EXAMPLES) {
    it(`${example.code} on the documented line`, () => {
      expect(lines(example.source, example.code)).toEqual(example.lines);
    });
  }

  it('gives nothing on the "use instead" versions', () => {
    const fixed = [
      'def area(radius):\n    return 3.14 * radius**2\n',
      'import foo\nimport bar\nbar.x(foo)\n',
      'def foo():\n    x = 1\n    return x\n',
      'arg = 1\nif arg is not None:\n    pass\n',
      'foo = 1\nif foo:\n    ...\n',
      'x = 200\nif x == 200:\n    print("It\'s 200!")\n',
      'if True:\n    a = 1\n',
    ];
    for (const source of fixed) expect(checkPython(source, parser.parse(source))).toEqual([]);
  });
});

describe('Python checker: scope rules', () => {
  const codes = (source: string) =>
    checkPython(source, parser.parse(source)).map((f) => `${f.code}:${lineAt(lineStarts(source), f.from)}`);

  it('lets a function use a module name bound after it', () => {
    expect(codes('def f():\n    return g()\n\ndef g():\n    return 1\n\nf()\n')).toEqual([]);
  });

  it('reports module code that reads a name before it is bound', () => {
    expect(codes('print(total)\ntotal = 1\n')).toEqual(['F821:1']);
  });

  it('hides class names from the methods inside the class', () => {
    expect(codes('class K:\n    size = 1\n    def f(self):\n        return size\n')).toEqual(['F821:4']);
  });

  it('knows builtins, comprehensions, lambdas, globals, patterns, and except names', () => {
    const source = [
      'import math',
      'def f(items, *args, key=len, **kw):',
      '    global counter',
      '    counter = 1',
      '    squares = [x * x for x in items if x]',
      '    g = lambda a, b=2: a + b + math.pi',
      '    try:',
      '        pass',
      '    except ValueError as err:',
      '        print(err, squares, g, args, kw, key)',
      '    match items:',
      '        case [first, *rest]:',
      '            return first, rest',
      'print(counter)',
    ].join('\n');
    expect(codes(source)).toEqual([]);
  });

  it('reports an unused except name and skips dummy names and locals()', () => {
    expect(codes('try:\n    pass\nexcept OSError as e:\n    pass\n')).toEqual(['F841:3']);
    expect(codes('def f():\n    _ = 1\n    __ = 2\n')).toEqual([]);
    expect(codes('def f():\n    x = 1\n    return locals()\n')).toEqual([]);
  });

  it('counts a name in __all__ as a use of the import', () => {
    expect(codes("from os import path\n__all__ = ['path']\n")).toEqual([]);
  });

  it('does not report a redefinition in another branch or after a use', () => {
    expect(codes('try:\n    import json\nexcept ImportError:\n    import simplejson as json\njson.dumps(1)\n')).toEqual(
      [],
    );
    expect(codes('def f():\n    pass\nf()\ndef f():\n    pass\nf()\n')).toEqual([]);
  });

  it('ignores tabs inside a multi-line string', () => {
    expect(codes('x = """\n\tkept\n"""\nprint(x)\n')).toEqual([]);
  });
});
