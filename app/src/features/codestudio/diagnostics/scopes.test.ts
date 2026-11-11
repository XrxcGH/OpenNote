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

  it('leaves macro names of an included system header to clang', () => {
    const text = join(
      '#include <errno.h>',
      '#include <signal.h>',
      '#include <stdint.h>',
      '#include <fcntl.h>',
      'int f(void) {',
      '  signal(SIGINT, SIG_IGN);',
      '  unsigned long m = UINT32_MAX + INT64_MAX + O_RDONLY;',
      '  return errno == ERANGE ? (int)m : 0;',
      '}',
    );
    expect(c(text)).toEqual([]);
    expect(c(join('int f(void) { return ERANGE; }'))).toEqual(['undeclared-identifier:1:ERANGE']);
  });

  it('declares function pointer variables and tables', () => {
    const text = join(
      'int add(int a, int b) { return a + b; }',
      'int apply(int (*g)(int, int), int x) { return g(x, x); }',
      'int f(void) {',
      '  int (*fp)(int, int) = add;',
      '  int (*table[2])(int, int) = { add, add };',
      '  return apply(fp, 1) + table[0](1, 2);',
      '}',
    );
    expect(c(text)).toEqual([]);
  });

  it('declares the names of structured bindings and range loops', () => {
    const text = join(
      '#include <map>',
      'int f(std::map<int, int> m) {',
      '  int total = 0;',
      '  for (auto& [key, val] : m) total += val + key;',
      '  for (int x : {1, 2}) total += x;',
      '  auto [lo, hi] = std::pair<int, int>(1, 2);',
      '  return total + lo + hi;',
      '}',
    );
    expect(c(text)).toEqual([]);
  });
});

describe('C and C++ scope checker: declarations', () => {
  it('declares default arguments, template parameters, and parameter packs', () => {
    expect(c(join('int f(int a, int b = 2) { return a + b; }'))).toEqual([]);
    expect(c(join('template <typename T, int N = 3> T twice(T v) { return v * N; }'))).toEqual([]);
    expect(c(join('template <int N> int twice() { return N * 2; }'))).toEqual([]);
    expect(c(join('template <typename... Ts> auto sum(Ts... xs) { return (xs + ...); }'))).toEqual([]);
    // The default value is a read, not a declaration.
    expect(c(join('int f(int b = limit) { return b; }'))).toEqual(['undeclared-identifier:1:limit']);
  });

  it('declares names from using declarations, namespaces, and lambda init captures', () => {
    const text = join(
      '#include <iostream>',
      'using std::cout;',
      'using std::endl;',
      'namespace util { int twice(int x) { return x * 2; } }',
      'int main() {',
      '  int y = 1;',
      '  auto h = [&, extra = 1](int z) { return y + z + extra; };',
      '  cout << util::twice(h(1)) << endl;',
      '  return 0;',
      '}',
    );
    expect(c(text)).toEqual([]);
    expect(c(join('namespace util { }', 'int f() { return 0; }'))).toEqual([]);
  });

  it('treats the arguments of a function-like macro of the file as declared', () => {
    const cpp = join(
      '#include <iostream>',
      'using namespace std;',
      '#define REP(i, n) for (int i = 0; i < (n); i++)',
      'int a[5];',
      'int main() {',
      '  int n = 3;',
      '  REP(i, n) cin >> a[i];',
      '  return 0;',
      '}',
    );
    expect(c(cpp)).toEqual([]);
    const cText = join(
      '#include <stdio.h>',
      '#define FOR(i, n) for (int i = 0; i < (n); i++)',
      'int main(void) {',
      '  FOR(i, 3) printf("%d", i);',
      '  return 0;',
      '}',
    );
    expect(c(cText)).toEqual([]);
  });

  it('declares a variable the grammar reads as a function definition', () => {
    const text = join(
      '#include <array>',
      'int len(std::array<int, 2> a);',
      'int f() {',
      '  std::array<int, 2> b{};',
      '  return len(b);',
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

  it('sees a global assigned after a line that ends in true, false, nil, ..., or end', () => {
    expect(lua(join('debug_mode = false', 'counter = 0', 'print(counter, debug_mode)'))).toEqual([]);
    const config = join(
      'fullscreen = false',
      'width = 800',
      'title = nil',
      'height = 600',
      'vsync = true',
      'depth = 24',
    );
    expect(lua(config + 'print(fullscreen, width, title, height, vsync, depth)\n')).toEqual([]);
    expect(lua(join('function f(...) local a = ...', '  b = 1', '  return a, b', 'end'))).toEqual([]);
  });

  it('reads one-line bodies as statements', () => {
    expect(lua(join('function init() state = 1 end', 'init()', 'print(state)'))).toEqual([]);
    expect(lua(join('for i = 1, 3 do local v = i * 2 print(v) end'))).toEqual([]);
    expect(lua(join('local x = 1 return x'))).toEqual([]);
  });
});

describe('Lua scope checker: function values', () => {
  it('declares a local whose value holds a function in the scope of the local statement', () => {
    expect(lua(join('local f = function(x) return x end', 'print(f(1))'))).toEqual([]);
    expect(lua(join('local f = function(x)', '  return x', 'end', 'print(f(1))'))).toEqual([]);
    expect(lua(join("local ok, err = pcall(function() error('x') end)", 'print(ok, err)'))).toEqual([]);
    expect(lua(join('local ok, err = pcall(function()', "  error('x')", 'end)', 'print(ok, err)'))).toEqual([]);
    const meta = 'local obj = setmetatable({}, { __index = function(_, k) return k end })';
    expect(lua(join(meta, 'print(obj.a)'))).toEqual([]);
    expect(
      lua(
        join(
          'local obj = setmetatable({}, {',
          '  __index = function(_, k)',
          '    return k',
          '  end,',
          '})',
          'print(obj.a)',
        ),
      ),
    ).toEqual([]);
    expect(lua(join('local co = coroutine.wrap(function() coroutine.yield(1) end)', 'print(co())'))).toEqual([]);
    expect(lua(join('local co = coroutine.wrap(function()', '  coroutine.yield(1)', 'end)', 'print(co())'))).toEqual(
      [],
    );
    expect(
      lua(
        join(
          'local counter = (function() local n = 0 return function() n = n + 1 return n end end)()',
          'print(counter())',
        ),
      ),
    ).toEqual([]);
    expect(
      lua(
        join(
          'local counter = (function()',
          '  local n = 0',
          '  return function()',
          '    n = n + 1',
          '    return n',
          '  end',
          'end)()',
          'print(counter())',
        ),
      ),
    ).toEqual([]);
  });

  it('keeps a repeat body visible to its until condition', () => {
    expect(lua(join('repeat', '  local done = true', 'until done'))).toEqual([]);
  });

  it('ignores names in strings and comments', () => {
    expect(lua(join('-- uses nothing_here', 'print("also_nothing")', '--[[ block', 'gone ]]'))).toEqual([]);
  });
});
