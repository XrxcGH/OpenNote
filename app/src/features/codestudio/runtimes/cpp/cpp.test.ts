// C and C++ with the real clang pack (the npm package the pack pins) and the real WASI shim, in Node.
//
// - The 20-program suite. Each expected output is worked by hand from the standards' rules. Unsigned arithmetic is
//   modulo 2^N (C17 6.2.5p9). The printf conversions are in C17 7.21.6.1. Integer division truncates (C17 6.5.5p6).
//
// - clang's known answers: the note that names <stdio.h> for printf (quoted in DESIGN 7.1) and "expected ';'".
// - Exit codes, standard input to its end, the seed, arguments, and files the program writes.
// - Escapes: no path outside the project mount opens. A program that imports anything but WASI is refused.
// - The header hints table, the flags, and the live check's debounce and worker.

// checks-disable-file modifiability: one describe block per feature
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunFile } from '../../contracts/run';
import { adapters, clang, main, run } from './fixtures/harness';
import { commandOf } from './clang';
import { CHECK_DELAY_MS, ClangChecker, LiveCheck, clangEngineCheck, readReply } from './checker';
import type { CheckRequest, CheckWorker } from './checker';
import { checkArgs, compileArgs, sourcesOf } from './flags';
import { HEADER_HINTS, headerFor, includeHint } from './headers';
import { programName } from './adapter';

const c = String.raw;

// Loading clang compiles a 75 MB WebAssembly module; a C++ compile with the standard library takes seconds.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

beforeAll(async () => {
  await adapters.c.load(() => {});
  await adapters.cpp.load(() => {});
});

describe('the clang pack', () => {
  it('is the version catalog.rs pins and reports clang 22', () => {
    const root = new URL('../../../../../../', import.meta.url);
    const pinned = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).devDependencies['@yowasp/clang'];
    expect(pinned).toBe('22.0.0-git20542-10');
    expect(readFileSync(new URL('app/src-tauri/src/packs/catalog.rs', root), 'utf8')).toContain(
      `@yowasp/clang@${pinned}/`,
    );
    expect(clang.version).toMatch(/^22\./);
    expect(adapters.c.version).toBe(`clang ${clang.version}`);
  });
});

interface Case {
  name: string;
  language: 'c' | 'cpp';
  files: RunFile[];
  stdin?: string;
  args?: string[];
  out: string;
}

const C_CASES: Case[] = [
  {
    name: 'hello',
    language: 'c',
    files: main(
      'c',
      c`#include <stdio.h>
int main(void) { printf("Hello, world!\n"); return 0; }
`,
    ),
    out: 'Hello, world!\n',
  },
  {
    name: 'unsigned arithmetic wraps modulo 2^N',
    language: 'c',
    files: main(
      'c',
      c`#include <stdio.h>
#include <limits.h>
#include <stdint.h>
int main(void) {
  unsigned int u = UINT_MAX; u += 1; printf("%u\n", u);
  unsigned char b = 255; b++; printf("%u\n", b);
  unsigned int z = 0; z -= 1; printf("%u\n", z);
  uint64_t big = UINT64_MAX; big += 2; printf("%llu\n", (unsigned long long)big);
  uint16_t h = 65000; h += 1000; printf("%u\n", h);
  return 0;
}
`,
    ),
    // 2^32 - 1 + 1 = 0; 255 + 1 = 0 (mod 256); 0 - 1 = 2^32 - 1; 2^64 - 1 + 2 = 1; 66000 - 65536 = 464.
    out: '0\n0\n4294967295\n1\n464\n',
  },
  {
    name: 'printf formatting',
    language: 'c',
    files: main(
      'c',
      c`#include <stdio.h>
int main(void) {
  printf("[%5d][%-5d][%05d][%+d]\n", 42, 42, 42, 42);
  printf("[%x][%X][%o][%#x]\n", 255, 255, 8, 255);
  printf("[%.3f][%8.2f][%e][%g]\n", 3.14159, 2.5, 12345.678, 0.0001);
  printf("[%s][%10s][%-10s][%.2s]\n", "abc", "abc", "abc", "abc");
  printf("[%c][%%][%5.1f][%ld]\n", 'A', 9.96, -123456789L);
  return 0;
}
`,
    ),
    out:
      '[   42][42   ][00042][+42]\n' +
      '[ff][FF][10][0xff]\n' +
      '[3.142][    2.50][1.234568e+04][0.0001]\n' +
      '[abc][       abc][abc       ][ab]\n' +
      '[A][%][ 10.0][-123456789]\n',
  },
  {
    name: 'scanf to the end of input',
    language: 'c',
    files: main(
      'c',
      c`#include <stdio.h>
int main(void) { int x, sum = 0; while (scanf("%d", &x) == 1) sum += x; printf("sum %d\n", sum); return 0; }
`,
    ),
    stdin: '3\n4 5\n',
    out: 'sum 12\n',
  },
  {
    name: 'arguments',
    language: 'c',
    files: main(
      'c',
      c`#include <stdio.h>
int main(int argc, char **argv) {
  printf("argc %d\n", argc);
  for (int i = 0; i < argc; i++) printf("%s\n", argv[i]);
  return 0;
}
`,
    ),
    args: ['a', 'b c'],
    out: 'argc 3\nmain\na\nb c\n',
  },
  {
    name: 'recursion with 64-bit integers',
    language: 'c',
    files: main(
      'c',
      c`#include <stdio.h>
long long fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }
int main(void) { printf("%lld\n", fact(20)); return 0; }
`,
    ),
    out: '2432902008176640000\n',
  },
  {
    name: 'pointers and structs',
    language: 'c',
    files: main(
      'c',
      c`#include <stdio.h>
struct point { int x, y; };
void swap(int *a, int *b) { int t = *a; *a = *b; *b = t; }
int main(void) { struct point p = {1, 2}; swap(&p.x, &p.y); printf("%d %d\n", p.x, p.y); return 0; }
`,
    ),
    out: '2 1\n',
  },
  {
    name: 'string.h',
    language: 'c',
    files: main(
      'c',
      c`#include <stdio.h>
#include <string.h>
int main(void) {
  char s[32]; strcpy(s, "hello"); strcat(s, " world");
  printf("%zu %d %s\n", strlen("hello"), strcmp("abc", "abc"), s);
  return 0;
}
`,
    ),
    out: '5 0 hello world\n',
  },
  {
    name: 'malloc and qsort',
    language: 'c',
    files: main(
      'c',
      c`#include <stdio.h>
#include <stdlib.h>
static int cmp(const void *a, const void *b) { return *(const int *)a - *(const int *)b; }
int main(void) {
  int *v = malloc(5 * sizeof *v); int init[] = {5, 3, 8, 1, 2};
  for (int i = 0; i < 5; i++) v[i] = init[i];
  qsort(v, 5, sizeof *v, cmp);
  for (int i = 0; i < 5; i++) printf("%d%c", v[i], i == 4 ? '\n' : ' ');
  free(v); return 0;
}
`,
    ),
    out: '1 2 3 5 8\n',
  },
  {
    name: 'reading a project file',
    language: 'c',
    files: [
      {
        path: 'main.c',
        text: c`#include <stdio.h>
int main(void) {
  FILE *f = fopen("data/lines.txt", "r"); char b[64]; int n = 0;
  while (fgets(b, sizeof b, f)) n++;
  printf("%d\n", n); fclose(f); return 0;
}
`,
      },
      { path: 'data/lines.txt', text: 'one\ntwo\nthree\n' },
    ],
    out: '3\n',
  },
  {
    name: 'integer division truncates toward zero',
    language: 'c',
    files: main(
      'c',
      c`#include <stdio.h>
int main(void) { printf("%d %d %d %d\n", -7 / 2, -7 % 2, 7 / -2, 7 % -2); return 0; }
`,
    ),
    out: '-3 -1 -3 1\n',
  },
  {
    name: 'math.h',
    language: 'c',
    files: main(
      'c',
      c`#include <stdio.h>
#include <math.h>
int main(void) { printf("%.6f %.0f %.1f %.1f\n", sqrt(2.0), pow(2, 10), floor(-2.5), ceil(-2.5)); return 0; }
`,
    ),
    out: '1.414214 1024 -3.0 -2.0\n',
  },
  {
    name: 'several files and a quoted include from the top folder',
    language: 'c',
    files: [
      {
        path: 'main.c',
        text: c`#include <stdio.h>
#include "lib/util.h"
int main(void) { printf("%d\n", twice(21)); return 0; }
`,
      },
      { path: 'lib/util.h', text: 'int twice(int x);\n' },
      { path: 'lib/util.c', text: '#include "util.h"\nint twice(int x) { return 2 * x; }\n' },
    ],
    out: '42\n',
  },
];

const CPP_CASES: Case[] = [
  {
    name: 'iostream and a sorted vector',
    language: 'cpp',
    files: main(
      'cpp',
      c`#include <algorithm>
#include <iostream>
#include <vector>
int main() {
  std::vector<int> v{5, 3, 1, 4, 2};
  std::sort(v.begin(), v.end());
  for (std::size_t i = 0; i < v.size(); ++i) std::cout << v[i] << (i + 1 < v.size() ? " " : "\n");
}
`,
    ),
    out: '1 2 3 4 5\n',
  },
  {
    name: 'words counted in a map',
    language: 'cpp',
    files: main(
      'cpp',
      c`#include <iostream>
#include <map>
#include <string>
int main() {
  std::map<std::string, int> count; std::string w;
  while (std::cin >> w) ++count[w];
  for (const auto &[word, n] : count) std::cout << word << ' ' << n << '\n';
}
`,
    ),
    stdin: 'b a b\n',
    out: 'a 1\nb 2\n',
  },
  {
    name: 'classes and virtual functions',
    language: 'cpp',
    files: main(
      'cpp',
      c`#include <cstdio>
#include <memory>
#include <vector>
struct Shape { virtual ~Shape() = default; virtual int area() const = 0; };
struct Square : Shape { int s; explicit Square(int s) : s(s) {} int area() const override { return s * s; } };
struct Rect : Shape { int w, h; Rect(int w, int h) : w(w), h(h) {} int area() const override { return w * h; } };
int main() {
  std::vector<std::unique_ptr<Shape>> shapes;
  shapes.push_back(std::make_unique<Square>(3));
  shapes.push_back(std::make_unique<Rect>(2, 3));
  for (const auto &s : shapes) std::printf("%d\n", s->area());
}
`,
    ),
    out: '9\n6\n',
  },
  {
    name: 'templates, lambdas and numeric',
    language: 'cpp',
    files: main(
      'cpp',
      c`#include <cstdint>
#include <iostream>
#include <numeric>
#include <vector>
template <typename T> T square(T x) { return x * x; }
int main() {
  std::vector<int> v(4);
  std::iota(v.begin(), v.end(), 1);
  int sum = std::accumulate(v.begin(), v.end(), 0, [](int a, int b) { return a + square(b); });
  std::uint8_t x = 250; x += 10;
  std::cout << sum << ' ' << +x << '\n';
}
`,
    ),
    // 1 + 4 + 9 + 16 = 30; 260 mod 256 = 4.
    out: '30 4\n',
  },
  {
    name: 'iomanip formatting',
    language: 'cpp',
    files: main(
      'cpp',
      c`#include <iomanip>
#include <iostream>
#include <string>
int main() {
  std::cout << std::fixed << std::setprecision(2) << 3.14159 << '\n';
  std::cout << '[' << std::setw(5) << 42 << "][" << std::left << std::setw(5) << 42 << "]\n";
  std::cout << std::hex << 255 << ' ' << std::to_string(7) << '\n';
}
`,
    ),
    out: '3.14\n[   42][42   ]\nff 7\n',
  },
];

describe('the 20-program suite', () => {
  it('has 20 programs in C and C++', () => {
    expect(C_CASES.length + CPP_CASES.length + 2).toBe(20);
  });

  for (const test of [...C_CASES, ...CPP_CASES]) {
    it(`${test.language}: ${test.name}`, async () => {
      const ran = await run(test.language, test.files, { stdin: test.stdin, args: test.args });
      expect(ran.err).not.toMatch(/warning|error/);
      expect(ran.out).toBe(test.out);
      expect(ran).toMatchObject({ status: 'ok', exitCode: 0, ran: true });
    });
  }

  it('c: exit(3) reports exit code 3 after its output', async () => {
    const ran = await run(
      'c',
      main(
        'c',
        c`#include <stdio.h>
#include <stdlib.h>
int main(void) { printf("before\n"); fflush(stdout); exit(3); }
`,
      ),
    );
    expect(ran).toMatchObject({ status: 'error', exitCode: 3, out: 'before\n' });
  });

  it('c: getchar reads standard input to its end', async () => {
    const ran = await run(
      'c',
      main(
        'c',
        c`#include <stdio.h>
int main(void) {
  int ch, n = 0, lines = 0;
  while ((ch = getchar()) != EOF) { n++; if (ch == '\n') lines++; }
  printf("%d %d\n", n, lines); return 0;
}
`,
      ),
      { stdin: 'abc\nde\n' },
    );
    // "abc\n" and "de\n": 7 characters, 2 lines; the program read past the end, so the console says so.
    expect(ran).toMatchObject({ status: 'ok', out: '7 2\n', inputEnded: true });
  });
});

describe('the compile and run phases', () => {
  it('prints its own lines before and after the compile step', async () => {
    const ran = await run('c', main('c', 'int main(void) { return 0; }\n'));
    expect(ran.err).toContain(`Compiling main.c with clang ${clang.version} (C17)`);
    expect(ran.err).toMatch(/Compiled in \d+\.\d\d seconds\. Running…/);
  });

  it('stops after a failed compile with clang messages mapped to the line', async () => {
    const ran = await run('c', main('c', 'int main(void) {\n  int x = 1\n  return x;\n}\n'));
    expect(ran).toMatchObject({ status: 'error', message: 'compile', ran: false });
    expect(ran.err).toContain("main.c:2:12: error: expected ';' at end of declaration");
    expect(ran.err).toContain('The compile step failed, so the program did not run.');
    expect(ran.diagnostics).toContainEqual({
      file: 'main.c',
      line: 2,
      column: 12,
      kind: 'error',
      message: "expected ';' at end of declaration",
    });
  });

  it('uses C++20 and turns exceptions off', async () => {
    const ran = await run('cpp', main('cpp', 'int main() { try { throw 1; } catch (...) {} }\n'));
    expect(ran.err).toContain('(C++20)');
    expect(ran.err).toContain("cannot use 'throw' with exceptions disabled");
  });

  it('maps a failed assert to its file and line', async () => {
    const ran = await run(
      'c',
      main('c', '#include <assert.h>\nint main(void) {\n  int x = 1;\n  assert(x == 2);\n}\n'),
    );
    expect(ran.status).toBe('error');
    expect(ran.diagnostics).toContainEqual({ file: 'main.c', line: 4, kind: 'assert', message: 'x == 2' });
  });
});

describe('clang known answers', () => {
  it('printf without its include gives the note that names <stdio.h>', async () => {
    const file = { path: 'main.c', text: 'int main(void) {\n  printf("hi\\n");\n  return 0;\n}\n' };
    const items = await adapters.c.check(file, [file]);
    expect(items).toContainEqual({
      file: 'main.c',
      line: 2,
      column: 3,
      kind: 'note',
      message: "include the header <stdio.h> or explicitly provide a declaration for 'printf'",
    });
    expect(items.find((item) => item.kind === 'error')?.message).toMatch(
      /^call to undeclared library function 'printf'/,
    );
    expect(includeHint(items.find((item) => item.kind === 'note')!.message, 'c')).toEqual({
      name: 'printf',
      header: '<stdio.h>',
    });
  });

  it("a missing semicolon gives expected ';' on the line of the statement", async () => {
    const file = { path: 'src/main.cpp', text: 'int main() {\n  int total = 0\n  return total;\n}\n' };
    const items = await adapters.cpp.check(file, [file]);
    expect(items).toEqual([
      { file: 'src/main.cpp', line: 2, column: 16, kind: 'error', message: "expected ';' at end of declaration" },
    ]);
  });

  it('reports -Wall -Wextra warnings and std names the table knows', async () => {
    const unused = { path: 'main.cpp', text: 'int main() {\n  int unused;\n}\n' };
    expect(await adapters.cpp.check(unused, [unused])).toEqual([
      {
        file: 'main.cpp',
        line: 2,
        column: 7,
        kind: 'warning',
        message: "unused variable 'unused' [-Wunused-variable]",
      },
    ]);
    const file = { path: 'main.cpp', text: '#include <cstdio>\nint main() {\n  std::vector<int> v;\n}\n' };
    const items = await adapters.cpp.check(file, [file]);
    const missing = items.find((item) => item.message.includes("'vector'"))!;
    expect(missing.message).toBe("no member named 'vector' in namespace 'std'");
    expect(includeHint(missing.message, 'cpp')).toEqual({ name: 'std::vector', header: '<vector>' });
  });

  it('checks a file with the project around it and reports only project files', async () => {
    const header = { path: 'inc/shape.h', text: 'int area(int w, int h);\n' };
    const file = {
      path: 'main.c',
      text: '#include <stdio.h>\n#include "inc/shape.h"\nint main(void) { return area(2); }\n',
    };
    const items = await adapters.c.check(file, [file, header]);
    expect(items.map((item) => [item.file, item.line, item.kind])).toEqual([
      ['main.c', 3, 'error'],
      ['inc/shape.h', 1, 'note'],
    ]);
  });
});

describe('the program sandbox', () => {
  it('opens no path outside the project mount, which is the root folder of the program', async () => {
    const ran = await run('c', [
      {
        path: 'main.c',
        text: c`#include <stdio.h>
#include <dirent.h>
static void try_open(const char *p) { FILE *f = fopen(p, "r"); printf("%s %d\n", p, f != NULL); if (f) fclose(f); }
int main(void) {
  const char *paths[] = {"data.txt", "/etc/passwd", "../secret.txt", "/project/main.c", "/main.c", "sub/../../x",
                         "/", "..", "/build/main.wasm", "/usr/include/stdio.h", "/tmp", "./data.txt"};
  for (unsigned i = 0; i < sizeof paths / sizeof *paths; i++) try_open(paths[i]);
  DIR *d = opendir("."); struct dirent *e; int n = 0;
  while ((e = readdir(d))) if (e->d_name[0] != '.') n++;
  printf("entries %d\n", n);
  printf("root %d\n", opendir("/") != NULL);
  return 0;
}
`,
      },
      { path: 'data.txt', text: 'x' },
    ]);
    expect(ran.out).toBe(
      [
        'data.txt 1',
        '/etc/passwd 0',
        '../secret.txt 0',
        '/project/main.c 0',
        '/main.c 1',
        'sub/../../x 0',
        '/ 1',
        '.. 0',
        '/build/main.wasm 0',
        '/usr/include/stdio.h 0',
        '/tmp 0',
        './data.txt 1',
        'entries 2',
        'root 1',
        '',
      ].join('\n'),
    );
  });

  it('refuses a program that imports anything but WASI', async () => {
    const ran = await run(
      'c',
      main(
        'c',
        c`__attribute__((import_module("env"), import_name("leak"))) void leak(void);
int main(void) { leak(); return 0; }
`,
      ),
    );
    expect(ran).toMatchObject({
      status: 'error',
      message: 'The program asks for env.leak, which a program here cannot use.',
    });
    expect(ran.out).toBe('');
  });

  it('keeps what the program writes in the overlay, not the project', async () => {
    const files = main(
      'c',
      c`#include <stdio.h>
int main(void) {
  FILE *f = fopen("out/result.txt", "w");
  if (!f) f = fopen("result.txt", "w");
  fputs("written\n", f); fclose(f); return 0;
}
`,
    );
    const ran = await run('c', files);
    expect(ran.written).toEqual([{ path: 'result.txt', text: 'written\n' }]);
    expect(files).toHaveLength(1);
  });

  it('gives the same random bytes for the same seed', async () => {
    const files = main(
      'cpp',
      c`#include <cstdio>
#include <random>
int main() { std::random_device rd; std::printf("%u\n", rd()); }
`,
    );
    const one = await run('cpp', files, { seed: 1 });
    const again = await run('cpp', files, { seed: 1 });
    const other = await run('cpp', files, { seed: 2 });
    expect(one.out).toBe(again.out);
    expect(one.out).not.toBe(other.out);
  });

  it('traps a stack overflow instead of writing over memory', async () => {
    const ran = await run(
      'c',
      main(
        'c',
        c`#include <stdio.h>
int deep(int n) { volatile char pad[1024]; pad[0] = (char)n; return deep(n + 1) + pad[0]; }
int main(void) { printf("%d\n", deep(0)); return 0; }
`,
      ),
    );
    expect(ran.status).toBe('error');
    expect(ran.message).toMatch(/^The program stopped: /);
  });

  it('keeps malloc inside the memory limit', async () => {
    const ran = await run(
      'c',
      main(
        'c',
        c`#include <stdio.h>
#include <stdlib.h>
static char *volatile kept[1000];
int main(void) {
  int n = 0;
  while (n < 1000) { char *p = malloc(1 << 20); if (!p) break; p[0] = 1; kept[n++] = p; }
  printf("%d\n", n < 8); return 0;
}
`,
      ),
      { limits: { memoryBytes: 8 * 1024 * 1024 } },
    );
    expect(ran).toMatchObject({ status: 'ok', out: '1\n' });
  });
});

describe('header hints', () => {
  it('names the header of C and C++ standard names', () => {
    expect(headerFor('printf', 'c')).toBe('<stdio.h>');
    expect(headerFor('malloc', 'c')).toBe('<stdlib.h>');
    expect(headerFor('std::vector', 'cpp')).toBe('<vector>');
    expect(headerFor('vector', 'cpp')).toBe('<vector>');
    expect(headerFor('std::cout', 'cpp')).toBe('<iostream>');
    expect(headerFor('printf', 'cpp')).toBe('<cstdio>');
    expect(headerFor('std::sqrt', 'cpp')).toBe('<cmath>');
    expect(headerFor('bool', 'cpp')).toBeNull();
    expect(headerFor('vector', 'c')).toBeNull();
    expect(headerFor('my_function', 'c')).toBeNull();
  });

  it('has each name once per language', () => {
    for (const table of Object.values(HEADER_HINTS)) expect(Object.keys(table).length).toBeGreaterThan(100);
  });

  it('reads the name from each clang message form', () => {
    expect(includeHint("use of undeclared identifier 'strlen'", 'c')).toEqual({ name: 'strlen', header: '<string.h>' });
    expect(includeHint("no template named 'map' in namespace 'std'", 'cpp')).toEqual({
      name: 'std::map',
      header: '<map>',
    });
    expect(includeHint("unknown type name 'uint8_t'", 'cpp')).toEqual({ name: 'uint8_t', header: '<cstdint>' });
    expect(includeHint("use of undeclared identifier 'frobnicate'", 'c')).toBeNull();
  });
});

describe('the driver', () => {
  it('reads the command lines of clang -###', () => {
    expect(commandOf(' "" "clang++" "-cc1" "-o" "/tmp/a b.o" "say \\"hi\\" \\\\ \\$x"')).toEqual([
      'clang++',
      '-cc1',
      '-o',
      '/tmp/a b.o',
      'say "hi" \\ $x',
    ]);
    expect(commandOf(' "wasm-ld" "-m" "wasm32"')).toEqual(['wasm-ld', '-m', 'wasm32']);
  });

  it('compiles with console gone, as after lockdown', async () => {
    const global = globalThis as { console?: Console };
    const kept = global.console;
    delete global.console;
    let ran: Awaited<ReturnType<typeof run>>;
    try {
      ran = await run(
        'c',
        main(
          'c',
          c`#include <stdio.h>
int main(void) { puts("no console"); return 0; }
`,
        ),
      );
    } finally {
      global.console = kept;
    }
    expect(ran).toMatchObject({ status: 'ok', out: 'no console\n' });
  });

  it('shows the driver error, not its own version lines', () => {
    const result = clang.run('clang', ['-working-directory', '/project', 'missing.c'], []);
    expect(result).toMatchObject({ code: 1, text: "clang: error: no such file or directory: 'missing.c'\n" });
  });
});

describe('the clang command line', () => {
  it('compiles every source of the language, the main file first', () => {
    const files = ['b.c', 'main.c', 'a.cpp', 'lib/a.c', 'x.h'].map((path) => ({ path, text: '' }));
    expect(sourcesOf('c', files, 'main.c')).toEqual(['main.c', 'b.c', 'lib/a.c']);
    expect(sourcesOf('cpp', files, 'main.c')).toEqual(['a.cpp']);
  });

  it('builds with the item flags and the run limits', () => {
    const args = compileArgs('cpp', ['main.cpp'], { memoryBytes: 64 * 1024 * 1024, stackBytes: 512 * 1024 });
    expect(args).toEqual(
      expect.arrayContaining(['-std=c++20', '-Wall', '-Wextra', '-O1', '-g', '-fno-exceptions', '-Wl,--stack-first']),
    );
    expect(args).toContain(`-Wl,--max-memory=${64 * 1024 * 1024}`);
    expect(args).toContain(`-Wl,-z,stack-size=${512 * 1024}`);
    expect(compileArgs('c', ['main.c'], { memoryBytes: 1 << 26, stackBytes: 1 << 19 })).toContain('-std=c17');
    expect(compileArgs('c', ['main.c'], { memoryBytes: 1 << 26, stackBytes: 1 << 19 }, { standard: 'c23' })).toContain(
      '-std=c23',
    );
    expect(checkArgs('c', 'main.c', { warnings: false })).not.toContain('-Wall');
    expect(checkArgs('cpp', 'x.hpp')).toEqual(expect.arrayContaining(['-fsyntax-only', '-x', 'c++-header', 'x.hpp']));
  });

  it('names the program after the main file', () => {
    expect(programName('src/hello.cpp')).toBe('hello');
    expect(programName('main.c')).toBe('main');
  });
});

describe('the live check', () => {
  afterEach(() => vi.useRealTimers());

  it('checks 800 ms after the last change and publishes only the newest result', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const published: [string, number][] = [];
    const live = new LiveCheck(
      async (_language, file) => {
        calls.push(file.text);
        return [{ file: file.path, line: 1, message: file.text, kind: 'error' }];
      },
      (path, items) => published.push([path, items.length]),
    );
    const change = (text: string) =>
      live.update({ language: 'c', file: { path: 'main.c', text }, files: [{ path: 'main.c', text }] });
    change('a');
    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS - 1);
    change('ab');
    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS - 1);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(['ab']);
    expect(published).toEqual([['main.c', 1]]);
    expect(CHECK_DELAY_MS).toBe(800);
  });

  it('drops a check that finishes after a newer change', async () => {
    vi.useFakeTimers();
    let finish: (() => void) | null = null;
    const published: string[] = [];
    const live = new LiveCheck(
      (_language, file) =>
        new Promise((resolve) => {
          finish = () => resolve([{ file: file.path, line: 1, message: file.text, kind: 'error' }]);
        }),
      (_path, items) => published.push(items[0]!.message),
    );
    live.update({ language: 'c', file: { path: 'main.c', text: 'old' }, files: [] });
    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS);
    live.update({ language: 'c', file: { path: 'main.c', text: 'new' }, files: [] });
    finish!();
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toEqual([]);
    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS);
    finish!();
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toEqual(['new']);
  });

  it('keeps one check worker warm and releases it when idle', async () => {
    vi.useFakeTimers();
    const made: StubWorker[] = [];
    const checker = new ClangChecker({ createWorker: () => made[made.push(new StubWorker()) - 1]!, idleMs: 1000 });
    const file = { path: 'main.c', text: '' };
    const first = checker.check('c', file, [file]);
    made[0]!.answer();
    expect(await first).toEqual([{ file: 'main.c', line: 1, message: 'm', kind: 'error' }]);
    const second = checker.check('cpp', file, [file]);
    made[0]!.answer();
    await second;
    expect(made).toHaveLength(1);
    expect(made[0]!.requests.map((request) => request.language)).toEqual(['c', 'cpp']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(made[0]!.ended).toBe(true);
    expect(checker.warm).toBe(false);
  });

  it('ends a check worker that takes too long and reports nothing', async () => {
    vi.useFakeTimers();
    const worker = new StubWorker();
    const checker = new ClangChecker({ createWorker: () => worker, timeoutMs: 500 });
    const file = { path: 'main.c', text: '' };
    const pending = checker.check('c', file, [file]);
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toEqual([]);
    expect(worker.ended).toBe(true);
  });

  it('reads replies field by field and gives L10 a compiler-layer check', () => {
    expect(
      readReply({ kind: 'checked', id: 1, items: [{ file: 'a.c', line: 0, message: 'x', kind: 'error' }] }),
    ).toEqual({ kind: 'checked', id: 1, items: [] });
    expect(readReply({ kind: 'other' })).toBeNull();
    const check = clangEngineCheck(new ClangChecker({ createWorker: () => new StubWorker() }));
    expect(check).toMatchObject({ id: 'clang', layer: 'compiler', languages: ['c', 'cpp'] });
  });
});

class StubWorker implements CheckWorker {
  requests: CheckRequest[] = [];
  ended = false;
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage(message: CheckRequest): void {
    this.requests.push(message);
  }

  terminate(): void {
    this.ended = true;
  }

  answer(): void {
    const request = this.requests[this.requests.length - 1]!;
    const items = [{ file: request.file.path, line: 1, message: 'm', kind: 'error' }];
    this.onmessage?.({ data: { kind: 'checked', id: request.id, items } } as MessageEvent);
  }
}
