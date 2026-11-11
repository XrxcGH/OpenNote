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

  // Valid programs that pyflakes and Ruff pass without a finding: the checker must give none either.
  it.each([
    ['a with name at module level', 'with open("data.txt") as f:\n    data = f.read()\nprint(data)\n'],
    ['a with name in a class', 'class A:\n    with open("d") as f:\n        text = f.read()\n'],
    ['a match capture at module level', 'match [1, 2]:\n    case [_, name]:\n        print(name)\n'],
    ['a match capture with a guard', 'match 3:\n    case n if n > 2:\n        print(n)\n'],
    ['an as pattern', 'match [1]:\n    case [x] as whole:\n        print(x, whole)\n'],
    ['a dotted decorator', 'import flask\napp = flask.Flask(__name__)\n@app.route("/")\ndef index():\n    pass\n'],
    [
      'a property setter',
      'class A:\n    @property\n    def x(self):\n        return 1\n    @x.setter\n    def x(self, v):\n        pass\n',
    ],
    [
      'a dotted call decorator',
      'import functools\ndef deco(fn):\n    @functools.wraps(fn)\n    def w():\n        return fn()\n    return w\n',
    ],
    ['a nested dotted decorator', 'import pytest\n@pytest.mark.parametrize("x", [1])\ndef test_x(x):\n    pass\n'],
    ['a generator as the only argument', 'words = ["a"]\nprint(sum(len(w) for w in words))\n'],
    ['a generator to join', 'xs = [1]\nprint(",".join(str(c) for c in xs))\n'],
    ['a generator to any', 'words = ["a"]\nprint(any(w for w in words))\n'],
    ['a comprehension in a class body', 'class A:\n    xs = [1]\n    ys = [x for x in xs]\n'],
    ['an import and a use on one line', 'import sys; sys.exit(0)\n'],
    ['PEP 695 function type parameters', 'def f[T](x: T) -> T:\n    return x\n'],
    ['PEP 695 class type parameters', 'class Box[T]:\n    def get(self) -> T:\n        return self.v\n'],
    ['a PEP 695 type alias', 'type Alias = list[int]\nx: Alias = [1]\nprint(x)\n'],
    ['a recursive type alias', 'type Tree = list[Tree] | int\n'],
    ['a string annotation', 'from typing import List\nx: "List[int]" = []\nprint(x)\n'],
    [
      'a TYPE_CHECKING import',
      'from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    from collections import OrderedDict\n' +
        'def f(d: "OrderedDict[str, int]") -> None:\n    print(d)\n',
    ],
  ])('gives nothing on %s', (_label, source) => {
    expect(codes(source)).toEqual([]);
  });

  it('still reports a name read in a class method and a with name read before its block', () => {
    expect(codes('print(f)\nwith open("d") as f:\n    pass\n')).toEqual(['F821:1']);
    expect(codes('class A:\n    xs = [1]\n    def f(self):\n        return [x for x in xs]\n')).toEqual(['F821:4']);
  });

  it('ignores tabs inside a multi-line string', () => {
    expect(codes('x = """\n\tkept\n"""\nprint(x)\n')).toEqual([]);
  });
});
