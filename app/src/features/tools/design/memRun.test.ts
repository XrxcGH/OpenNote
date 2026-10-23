import { describe, expect, it } from 'vitest';
import { STEP_CAP, run } from './memRun';
import type { BlockView, RunResult, Snapshot } from './memRun';

function ok(src: string): RunResult {
  const r = run(src);
  if (!r.ok) throw new Error(`line ${r.line}: ${r.detail}`);
  return r;
}

/** The state just before the end snapshot. */
function last(r: RunResult): Snapshot {
  return r.snapshots[r.snapshots.length - 2]!;
}

function variable(s: Snapshot, name: string): BlockView {
  const all = [...s.frames.flatMap((f) => f.vars), ...s.globals];
  const v = all.find((b) => b.name === name);
  if (!v) throw new Error(`no variable ${name}`);
  return v;
}

const text = (s: Snapshot, name: string, cell = 0) => variable(s, name).cells[cell]!.text;
const kinds = (r: RunResult) => r.warnings.map((w) => `${w.kind}@${w.line}`);

describe('pointers and references', () => {
  it('int x = 5; int* p = &x; *p = 7;', () => {
    const r = ok('int x = 5;\nint* p = &x;\n*p = 7;');
    const s = last(r);
    expect(text(s, 'x')).toBe('7');
    const p = variable(s, 'p').cells[0]!;
    expect(p.points).toEqual({ block: variable(s, 'x').id, index: 0 });
    expect(r.warnings).toEqual([]);
  });

  it('int a[3] = {1,2,3}; int* q = a + 1; *q = 9;', () => {
    const r = ok('int a[3] = {1, 2, 3};\nint* q = a + 1;\n*q = 9;');
    const s = last(r);
    expect(variable(s, 'a').cells.map((c) => c.text)).toEqual(['1', '9', '3']);
    expect(variable(s, 'q').cells[0]!.points).toEqual({ block: variable(s, 'a').id, index: 1 });
    // element addresses are 4 bytes apart
    const [c0, c1] = variable(s, 'a').cells;
    expect(parseInt(c1!.addr, 16) - parseInt(c0!.addr, 16)).toBe(4);
  });

  it('int& r = x; r++; with x = 7 gives 8', () => {
    const r = ok('int x = 7;\nint& r = x;\nr++;');
    const s = last(r);
    expect(text(s, 'x')).toBe('8');
    expect(variable(s, 'r').refTo).toEqual({ block: variable(s, 'x').id, index: 0 });
  });

  it('compound assignment, increment and decrement', () => {
    const s = last(ok('int x = 10;\nx += 5;\nx *= 2;\nint y = x--;\nint z = --x;'));
    expect(text(s, 'x')).toBe('28');
    expect(text(s, 'y')).toBe('30');
    expect(text(s, 'z')).toBe('28');
  });
});

describe('heap', () => {
  it('int* h = new int(4); h = nullptr; leaks the block', () => {
    const r = ok('int* h = new int(4);\nh = nullptr;');
    expect(kinds(r)).toEqual(['leak@1']);
    const end = r.snapshots[r.snapshots.length - 1]!;
    expect(end.heap).toHaveLength(1);
    expect(end.heap[0]!.cells[0]!.text).toBe('4');
  });

  it('delete frees and a second delete is flagged', () => {
    const r = ok('int* h = new int(4);\ndelete h;\ndelete h;');
    expect(kinds(r)).toEqual(['doubleDelete@3']);
  });

  it('use after delete is flagged on that line and the pointer dangles', () => {
    const r = ok('int* h = new int(4);\ndelete h;\nint v = *h;');
    expect(kinds(r)).toEqual(['useAfterDelete@3']);
    expect(variable(last(r), 'h').cells[0]!.points).toBe('dangling');
  });

  it('new[] and delete[] pair; mixing the forms is flagged', () => {
    expect(ok('int* a = new int[3];\ndelete[] a;').warnings).toEqual([]);
    expect(kinds(ok('int* a = new int[3];\ndelete a;'))).toEqual(['badDelete@2']);
  });

  it('a linked list of structs follows its pointers', () => {
    const r = ok(
      'struct Node { int v; Node* next; };\nNode* a = new Node();\nNode* b = new Node();\na->v = 1;\nb->v = 2;\na->next = b;\nint s = a->next->v;\ndelete b;\ndelete a;',
    );
    expect(text(last(r), 's')).toBe('2');
    expect(r.warnings).toEqual([]);
  });

  it('deleting a stack variable address is flagged', () => {
    expect(kinds(ok('int x = 1;\nint* p = &x;\ndelete p;'))).toEqual(['badDelete@3']);
  });
});

describe('undefined behaviour', () => {
  it('int b[2]; b[2] = 1; is an out-of-bounds write on that line', () => {
    const r = ok('int b[2];\nb[2] = 1;');
    expect(kinds(r)).toEqual(['outOfBounds@2']);
    expect(variable(last(r), 'b').cells.map((c) => c.text)).toEqual(['?', '?']);
  });

  it('reads outside an array and negative indexes are flagged', () => {
    const r = ok('int a[3] = {1, 2, 3};\nint x = a[5];\nint y = a[-1];');
    expect(kinds(r)).toEqual(['outOfBounds@2', 'outOfBounds@3']);
  });

  it('pointer arithmetic that leaves the block is caught when dereferenced', () => {
    const r = ok('int a[2] = {1, 2};\nint* p = a + 2;\nint x = *p;');
    expect(kinds(r)).toEqual(['outOfBounds@3']);
  });

  it('uninitialized reads', () => {
    const r = ok('int x;\nint y = x + 1;');
    expect(kinds(r)).toEqual(['uninitialized@2']);
  });

  it('null dereference stops the program like a crash', () => {
    const r = ok('int* p = nullptr;\nint x = *p;\nint y = 3;');
    expect(kinds(r)).toEqual(['nullDeref@2']);
    expect(r.snapshots.some((s) => s.line === 3)).toBe(false);
  });

  it('division by zero crashes', () => {
    const r = ok('int a = 5;\nint b = 0;\nint c = a / b;');
    expect(kinds(r)).toEqual(['divideByZero@3']);
  });

  it('a pointer to a local dangles after the function returns', () => {
    const r = ok('int* f() {\n  int x = 3;\n  return &x;\n}\nint* p = f();\nint y = *p;');
    expect(kinds(r)).toEqual(['dangling@6']);
  });

  it('signed overflow is flagged and wraps', () => {
    const r = ok('int x = 2147483647;\nx = x + 1;');
    expect(kinds(r)).toEqual(['overflow@2']);
    expect(text(last(r), 'x')).toBe('-2147483648');
  });
});

describe('arithmetic', () => {
  it('7 / 2 is 3 and a + 1 for a char is 98', () => {
    const s = last(ok("int q = 7 / 2;\nint c = 'a' + 1;\nint r = -7 % 3;\ndouble d = 7 / 2.0;\nint t = -7 / 2;"));
    expect(text(s, 'q')).toBe('3');
    expect(text(s, 'c')).toBe('98');
    expect(text(s, 'r')).toBe('-1');
    expect(text(s, 'd')).toBe('3.5');
    expect(text(s, 't')).toBe('-3');
  });

  it('assigning a double to an int truncates; char wraps to 8 bits', () => {
    const s = last(ok('int n = 3.99;\nchar c = 200;\nbool b = 5;'));
    expect(text(s, 'n')).toBe('3');
    expect(text(s, 'c')).toBe('-56');
    expect(text(s, 'b')).toBe('true');
  });

  it('cout prints expressions', () => {
    const r = ok(
      'cout << 7 / 2 << \' \' << \'a\' + 1 << " " << 3.0 / 4 << 1.0 / 3 << endl;\nstd::cout << true << "x\\n";',
    );
    expect(r.output).toBe('3 98 0.750.333333\n1x\n');
  });

  it('prints doubles like C++ (6 significant digits)', () => {
    const r = ok('cout << 1000000.0 << " " << 0.0001 << " " << 123456789.0 << " " << 100.0;');
    expect(r.output).toBe('1e+06 0.0001 1.23457e+08 100');
  });
});

describe('control flow and functions', () => {
  it('for, while and if', () => {
    const r = ok(
      'int sum = 0;\nfor (int i = 1; i <= 4; i++) {\n  if (i % 2 == 0) sum += i;\n}\nint k = 0;\nwhile (k < 3) k++;',
    );
    const s = last(r);
    expect(text(s, 'sum')).toBe('6');
    expect(text(s, 'k')).toBe('3');
    expect(r.snapshots.some((x) => x.kind === 'condition')).toBe(true);
  });

  it('pass by value does not change the caller, pass by reference does', () => {
    const src =
      'void byValue(int a) { a = 99; }\nvoid byRef(int& a) { a = 42; }\nint main() {\n  int x = 1;\n  int y = 1;\n  byValue(x);\n  byRef(y);\n  cout << x << y;\n  return 0;\n}';
    const r = ok(src);
    expect(r.output).toBe('142');
  });

  it('a pointer parameter changes the caller', () => {
    const r = ok('void inc(int* p) { (*p)++; }\nint main() { int n = 4; inc(&n); cout << n; }');
    expect(r.output).toBe('5');
  });

  it('recursion', () => {
    const r = ok('int fact(int n) { if (n <= 1) return 1; return n * fact(n - 1); }\nint main() { cout << fact(5); }');
    expect(r.output).toBe('120');
  });

  it('snapshots show call frames', () => {
    const r = ok('int twice(int n) { return n * 2; }\nint main() { int v = twice(4); }');
    const inCall = r.snapshots.find((s) => s.kind === 'call' && s.frames.length === 2)!;
    expect(inCall.frames.map((f) => f.fn)).toEqual(['main', 'twice']);
    expect(inCall.frames[1]!.vars[0]!.cells[0]!.text).toBe('4');
  });

  it('structs copy by value and are reached by . and ->', () => {
    const r = ok('struct P { int x; int y; };\nP a = {1, 2};\nP b = a;\nb.x = 9;\nP* q = &a;\nq->y = 7;');
    const s = last(r);
    expect(variable(s, 'a').cells.map((c) => c.text)).toEqual(['1', '7']);
    expect(variable(s, 'b').cells.map((c) => c.text)).toEqual(['9', '2']);
  });

  it('global variables are zero-initialized', () => {
    const r = ok('int g;\nint main() { cout << g; g = 3; cout << g; }');
    expect(r.output).toBe('03');
  });

  it('strings in char arrays', () => {
    const r = ok('char s[] = "hi";\nchar* p = s;\np++;\ncout << s << p;');
    expect(r.output).toBe('hii');
    expect(variable(last(r), 's').cells.map((c) => c.text)).toEqual(["'h' 104", "'i' 105", '0']);
  });
});

describe('limits and unsupported code', () => {
  it('an endless loop stops at the step cap', () => {
    const r = ok('int i = 0;\nwhile (true) { i++; }');
    expect(r.truncated).toBe(true);
    expect(r.steps).toBeGreaterThan(STEP_CAP);
    expect(kinds(r)).toContain('stepCap@2');
    expect(r.snapshots.length).toBeLessThanOrEqual(2001);
  });

  it('names unsupported constructs with their line', () => {
    expect(run('int x = 1;\nstd::string s;')).toMatchObject({ ok: false, line: 2, kind: 'unsupported' });
    expect(run('int x = 1;\nswitch (x) { }')).toMatchObject({ ok: false, line: 2, kind: 'unsupported' });
    expect(run('int x;\ncin >> x;')).toMatchObject({ ok: false, line: 2, kind: 'unsupported' });
    expect(run('long y = 2;')).toMatchObject({ ok: false, line: 1, kind: 'unsupported' });
  });

  it('reports syntax errors with their line', () => {
    expect(run('int x = 5\nint y = 6;')).toMatchObject({ ok: false, line: 2, kind: 'syntax' });
    expect(run('int x = ;')).toMatchObject({ ok: false, line: 1, kind: 'syntax' });
    expect(run('{ int x = 1;')).toMatchObject({ ok: false, kind: 'syntax' });
  });

  it('stops at an unknown function but keeps what ran', () => {
    const r = ok('int x = 1;\nint y = foo(x);\nint z = 3;');
    expect(r.stop).toMatchObject({ line: 2, kind: 'unsupported' });
    expect(r.snapshots.some((s) => s.line === 3)).toBe(false);
  });

  it('type errors stop the run with a message', () => {
    const r = ok('int x = 1;\nint* p = x;');
    expect(r.stop).toMatchObject({ line: 2, kind: 'error' });
  });

  it('empty and comment-only programs run to an end snapshot', () => {
    const r = ok('// nothing\n');
    expect(r.snapshots).toHaveLength(1);
    expect(r.warnings).toEqual([]);
  });

  it('marks changed cells in the snapshot after a write', () => {
    const r = ok('int x = 1;\nx = 2;');
    const s = r.snapshots.find((x) => x.line === 2)!;
    expect(variable(s, 'x').cells[0]!.changed).toBe(true);
    expect(variable(r.snapshots[0]!, 'x').cells[0]!.changed).toBe(false);
  });
});
