// ESLint-parity known answers (ADR 0074): each input is an "incorrect code" example from ESLint's documentation of
// that rule, kept with its `/*eslint*/` line, and the expected lines are the ones the rule's documentation describes
// as reported. The "correct code" examples must give nothing for the rule.

import { parser } from '@lezer/javascript';
import { describe, expect, it } from 'vitest';
import { checkJavaScript } from './javascript';
import { lineAt, lineStarts } from './text';

const ts = parser.configure({ dialect: 'ts' });

function lines(source: string, code: string, typescript = false): number[] {
  const starts = lineStarts(source);
  const tree = (typescript ? ts : parser).parse(source);
  return checkJavaScript(source, tree)
    .filter((f) => f.code === code)
    .map((f) => lineAt(starts, f.from));
}

const join = (...rows: string[]) => rows.join('\n') + '\n';

describe('JavaScript checker: ESLint documentation examples', () => {
  it('no-undef', () => {
    const source = join('/*eslint no-undef: "error"*/', '', 'const foo = someFunction();', 'const bar = a + 1;');
    expect(lines(source, 'no-undef')).toEqual([3, 4]);
    const correct = join(
      '/*global someFunction, a*/',
      '/*eslint no-undef: "error"*/',
      '',
      'const foo = someFunction();',
      'const bar = a + 1;',
    );
    expect(lines(correct, 'no-undef')).toEqual([]);
    expect(
      lines(join('if (typeof UndefinedIdentifier === "undefined") {', '    // do something ...', '}'), 'no-undef'),
    ).toEqual([]);
  });

  it('no-unused-vars', () => {
    const source = join(
      '/*eslint no-unused-vars: "error"*/',
      '/*global some_unused_var*/',
      '',
      '// It checks variables you have defined as global',
      'some_unused_var = 42;',
      '',
      'let x;',
      '',
      '// Write-only variables are not considered as used.',
      'let y = 10;',
      'y = 5;',
      '',
      '// A read for a modification of itself is not considered as used.',
      'let z = 0;',
      'z = z + 1;',
      '',
      '// By default, unused arguments cause warnings.',
      '(function(foo) {',
      '    return 5;',
      '})();',
      '',
      '// Unused recursive functions also cause warnings.',
      'function fact(n) {',
      '    if (n < 2) return 1;',
      '    return n * fact(n - 1);',
      '}',
      '',
      '// When a function definition destructures an array, unused entries from the array also cause warnings.',
      'function getY([x, y]) {',
      '    return y;',
      '}',
      'getY(["a", "b"]);',
    );
    expect(lines(source, 'no-unused-vars')).toEqual([5, 7, 11, 15, 18, 23, 29]);
    const correct = join(
      '/*eslint no-unused-vars: "error"*/',
      '',
      'const x = 10;',
      'alert(x);',
      '',
      '// foo is considered used here',
      'myFunc(function foo() {',
      '    // ...',
      '}.bind(this));',
      '',
      '(function(foo) {',
      '    return foo;',
      '})();',
      '',
      'var myFunc;',
      'myFunc = setTimeout(function() {',
      '    // myFunc is considered used',
      '    myFunc();',
      '}, 50);',
      '',
      '// Only the second argument from the destructured array is used.',
      'function getY([, y]) {',
      '    return y;',
      '}',
      'getY(["a", "b"]);',
    );
    expect(lines(correct, 'no-unused-vars')).toEqual([]);
  });

  it('no-const-assign', () => {
    expect(lines(join('/*eslint no-const-assign: "error"*/', '', 'const a = 0;', 'a = 1;'), 'no-const-assign')).toEqual(
      [4],
    );
    expect(
      lines(join('/*eslint no-const-assign: "error"*/', '', 'const a = 0;', 'a += 1;'), 'no-const-assign'),
    ).toEqual([4]);
    expect(lines(join('/*eslint no-const-assign: "error"*/', '', 'const a = 0;', '++a;'), 'no-const-assign')).toEqual([
      4,
    ]);
    expect(
      lines(
        join(
          '/*eslint no-const-assign: "error"*/',
          '',
          'for (const a in [1, 2, 3]) { // `a` is re-defined (not modified) on each loop step.',
          '    a = 1;',
          '}',
        ),
        'no-const-assign',
      ),
    ).toEqual([4]);
    expect(
      lines(
        join('const a = 0;', 'console.log(a);', 'for (const a in [1, 2, 3]) {', '    console.log(a);', '}'),
        'no-const-assign',
      ),
    ).toEqual([]);
  });

  it('no-unreachable', () => {
    const source = join(
      '/*eslint no-unreachable: "error"*/',
      '',
      'function foo() {',
      '    return true;',
      '    console.log("done");',
      '}',
      '',
      'function bar() {',
      '    throw new Error("Oops!");',
      '    console.log("done");',
      '}',
      '',
      'while(value) {',
      '    break;',
      '    console.log("done");',
      '}',
      '',
      'throw new Error("Oops!");',
      'console.log("done");',
      '',
      'function baz() {',
      '    if (Math.random() < 0.5) {',
      '        return;',
      '    } else {',
      '        throw new Error();',
      '    }',
      '    console.log("done");',
      '}',
      '',
      'for (;;) {}',
      'console.log("done");',
    );
    // The `throw` on line 18 already makes lines 30 and 31 unreachable, so their run is marked from line 30.
    expect(lines(source, 'no-unreachable')).toEqual([5, 10, 15, 19, 27, 30]);
    expect(lines(join('for (;;) {}', 'console.log("done");'), 'no-unreachable')).toEqual([2]);
    expect(
      lines(
        join(
          'function foo() {',
          '    return bar();',
          '    function bar() {',
          '        return 1;',
          '    }',
          '}',
          'while (true) {',
          '    if (x) break;',
          '}',
          'console.log("done");',
        ),
        'no-unreachable',
      ),
    ).toEqual([]);
  });

  it('eqeqeq', () => {
    const source = join(
      '/*eslint eqeqeq: "error"*/',
      '',
      'if (x == 42) { }',
      '',
      'if ("" == text) { }',
      '',
      'if (obj.getStuff() != undefined) { }',
    );
    expect(lines(source, 'eqeqeq')).toEqual([3, 5, 7]);
    expect(lines(join('if (x === 42) { }', 'if (a !== b) { }'), 'eqeqeq')).toEqual([]);
  });

  it('no-cond-assign', () => {
    const source = join(
      '/*eslint no-cond-assign: "error"*/',
      '',
      '// Unintentional assignment',
      'let x;',
      'if (x = 0) {',
      '    const b = 1;',
      '}',
      '',
      '// Practical example that is similar to an error',
      'const setHeight = function (someNode) {',
      '    do {',
      '        someNode.height = "100px";',
      '    } while (someNode = someNode.parentNode);',
      '}',
    );
    expect(lines(source, 'no-cond-assign')).toEqual([5, 13]);
    const correct = join(
      'let x;',
      'if (x === 0) {',
      '    const b = 1;',
      '}',
      'const setHeight = function (someNode) {',
      '    do {',
      '        someNode.height = "100px";',
      '    } while ((someNode = someNode.parentNode));',
      '}',
    );
    expect(lines(correct, 'no-cond-assign')).toEqual([]);
  });

  it('no-fallthrough', () => {
    const source = join(
      '/*eslint no-fallthrough: "error"*/',
      '',
      'switch(foo) {',
      '    case 1:',
      '        doSomething();',
      '',
      '    case 2:',
      '        doSomething();',
      '}',
    );
    expect(lines(source, 'no-fallthrough')).toEqual([7]);
    const correct = join(
      'switch(foo) {',
      '    case 1:',
      '        doSomething();',
      '        break;',
      '    case 2:',
      '        doSomething();',
      '}',
      'function bar(foo) {',
      '    switch(foo) {',
      '        case 1:',
      '            doSomething();',
      '            return;',
      '        case 2:',
      '            doSomething();',
      '    }',
      '}',
      'switch(foo) {',
      '    case 1:',
      '        doSomething();',
      '        // falls through',
      '    case 2:',
      '        doSomething();',
      '}',
      'switch(foo) {',
      '    case 1:',
      '    case 2:',
      '        doSomething();',
      '}',
    );
    expect(lines(correct, 'no-fallthrough')).toEqual([]);
  });
});

describe('JavaScript checker: scopes', () => {
  it('handles imports, exports, classes, closures, and patterns', () => {
    const source = join(
      "import d, { a as b, c } from 'm';",
      'export const k = d + b;',
      'export function run({ v }, ...rest) {',
      '  const f = (w) => w + v + rest.length;',
      '  class C { m(q) { return q + c; } }',
      '  try { return f(new C()); } catch (e) { return e; }',
      '}',
      'const o = { k };',
      'export { o };',
    );
    const found = checkJavaScript(source, parser.parse(source)).filter((f) => f.code.startsWith('no-'));
    expect(found).toEqual([]);
  });

  it('skips TypeScript types for no-undef and counts them as uses', () => {
    const source = join(
      "import type { Shape } from './shape';",
      'interface Box { size: Size; }',
      'function area(s: Shape, b: Box): number { return s.w * b.size; }',
      'console.log(area);',
    );
    expect(lines(source, 'no-undef', true)).toEqual([]);
    expect(lines(source, 'no-unused-vars', true)).toEqual([]);
  });
});
