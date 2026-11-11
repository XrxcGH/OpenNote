// The scope checkers for C, C++, and Lua. The expected answers are worked by hand from each language's scope rules.
// In C11 section 6.2.1 and C++ [basic.scope], a name is visible from its declaration to the end of its block.
// In the Lua 5.4 manual section 3.5, a local is visible from the statement after its declaration to the end of its
// block.

import { parser as cppParser } from '@lezer/cpp';
import { describe, expect, it } from 'vitest';
import { checkCLike } from './clike';
import { checkLua } from './lua';
import { lineAt, lineStarts } from './text';

const join = (...rows: string[]) => rows.join('\n') + '\n';

function c(text: string): string[] {
  const starts = lineStarts(text);
  return checkCLike(text, cppParser.parse(text)).map((f) => `${f.code}:${lineAt(starts, f.from)}:${f.params?.name}`);
}

function lua(text: string): string[] {
  const starts = lineStarts(text);
  return checkLua(text).map((f) => `${f.code}:${lineAt(starts, f.from)}:${f.params?.name}`);
}

describe('C and C++ scope checker', () => {
  it('finds an undeclared identifier and an unused local', () => {
    const text = join(
      '#include <stdio.h>',
      '#define LIMIT 10',
      'int total = 0;',
      'int add(int a, int b) {',
      '  int unused = 0;',
      '  int sum = a + b + count;',
      '  return sum + LIMIT + total;',
      '}',
    );
    expect(c(text)).toEqual(['unused-variable:5:unused', 'undeclared-identifier:6:count']);
  });

  it('ends a block variable at its closing brace', () => {
    const text = join('int f(void) {', '  { int inner = 1; inner++; }', '  return inner;', '}');
    expect(c(text)).toEqual(['undeclared-identifier:3:inner']);
  });

  it('leaves calls, members, enums, loop variables, and std names alone', () => {
    const text = join(
      '#include <iostream>',
      'using namespace std;',
      'enum Color { RED, GREEN };',
      'struct P { int x; };',
      'class K { int m; void set() { m = RED; } };',
      'int main() {',
      '  P p; p.x = GREEN;',
      '  for (int i = 0; i < 3; i++) cout << helper(i) << endl;',
      '  return EXIT_SUCCESS;',
      '}',
    );
    expect(c(text)).toEqual([]);
  });

  it('stays quiet about undeclared names when a project header may declare them', () => {
    expect(c(join('#include "shapes.h"', 'int f(void) { return SIDES; }'))).toEqual([]);
  });

  it('does not report a class object or a marked variable as unused', () => {
    const text = join(
      '#include <mutex>',
      'std::mutex m;',
      'void f() {',
      '  std::lock_guard<std::mutex> lock(m);',
      '  [[maybe_unused]] int spare = 0;',
      '}',
    );
    expect(c(text)).toEqual([]);
  });
});

describe('Lua scope checker', () => {
  it('finds an undefined global and an unused local', () => {
    const text = join(
      'local count = 0',
      'local spare = 1',
      'for i = 1, 10 do',
      '  count = count + i',
      'end',
      'print(count, totl)',
    );
    expect(lua(text)).toEqual(['W211:2:spare', 'W113:6:totl']);
  });

  it('knows globals the file assigns, functions, methods, and table keys', () => {
    const text = join(
      'function greet(name)',
      '  return "hi " .. name',
      'end',
      'Point = {}',
      'function Point:len()',
      '  return math.sqrt(self.x ^ 2 + self.y ^ 2)',
      'end',
      'local t = { x = 1, y = 2 }',
      'setmetatable(t, { __index = Point })',
      'print(greet("a"), t:len())',
    );
    expect(lua(text)).toEqual([]);
  });

  it('ends a local at the end of its block, and reads the outer name in its own initializer', () => {
    const text = join('local x = 1', 'do', '  local y = x', '  local x = x + y', '  print(x)', 'end', 'print(y)');
    expect(lua(text)).toEqual(['W113:7:y']);
  });

  it('keeps a repeat body visible to its until condition', () => {
    expect(lua(join('repeat', '  local done = true', 'until done'))).toEqual([]);
  });

  it('ignores names in strings and comments', () => {
    expect(lua(join('-- uses nothing_here', 'print("also_nothing")', '--[[ block', 'gone ]]'))).toEqual([]);
  });
});
