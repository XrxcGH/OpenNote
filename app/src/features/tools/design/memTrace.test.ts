import { describe, expect, it } from 'vitest';
import { en } from '../../../strings/en';
import { PAGE } from './kit/plot';
import { layoutMemory, memorySvg } from './memDrawing';
import { run } from './memRun';
import type { RunResult, WarnKind } from './memRun';
import { summaryText, traceRows, variableRows } from './memTrace';

function ok(src: string): RunResult {
  const r = run(src);
  if (!r.ok) throw new Error(r.detail);
  return r;
}
const end = (r: RunResult) => r.snapshots[r.snapshots.length - 2]!;
const labels = { stack: 'Stack', heap: 'Heap', globals: 'Globals', freed: 'freed', nullPointer: 'null' };

describe('the tracer in words', () => {
  it('int x = 5; int* p = &x; *p = 7; gives x = 7 and p pointing at x', () => {
    const r = ok('int x = 5;\nint* p = &x;\n*p = 7;');
    expect(summaryText(end(r))).toBe('x = 7, p = → x');
  });
  it('an array is shown with every element: {1, 9, 3}', () => {
    const r = ok('int a[3] = {1, 2, 3};\nint* q = a + 1;\n*q = 9;');
    expect(summaryText(end(r))).toBe('a = {1, 9, 3}, q = → a[1]');
  });
  it('a reference reads as the variable it stands for, and the change shows in x', () => {
    const r = ok('int x = 7;\nint& r = x;\nr++;');
    expect(summaryText(end(r))).toBe('x = 8, r = &x');
  });
  it('a lost heap block is listed and warned about at the end', () => {
    const r = ok('int* h = new int(4);\nh = nullptr;');
    expect(variableRows(end(r)).map((v) => `${v.region}:${v.name}=${v.value}`)).toEqual(['stack:h=null', 'heap:#2=4']);
    expect(r.warnings.map((w) => w.kind)).toEqual(['leak']);
  });
  it('the trace table has a row per step, with the source line and the state', () => {
    const src = 'int x = 5;\nx = x + 2;';
    const rows = traceRows(ok(src), src);
    expect(rows[0]).toEqual(['1', '1', 'int x = 5;', 'x = 5']);
    expect(rows[1]).toEqual(['2', '2', 'x = x + 2;', 'x = 7']);
  });
  it('7 / 2 prints 3 and a character plus one prints 98', () => {
    expect(ok("cout << 7 / 2 << endl;\ncout << 'a' + 1 << endl;").output).toBe('3\n98\n');
  });
  it('an out-of-bounds write is flagged on its own line', () => {
    const r = ok('int b[2];\nb[0] = 1;\nb[2] = 1;');
    expect(r.warnings.find((w) => w.kind === 'outOfBounds')?.line).toBe(3);
  });
});

describe('the memory picture', () => {
  it('has one arrow for each pointer that can be followed, and a dashed one for a reference', () => {
    const r = ok('int x = 5;\nint* p = &x;\nint* h = new int(4);\nint& q = x;');
    const lay = layoutMemory(end(r));
    expect(lay.arrows).toHaveLength(3);
    expect(lay.arrows.filter((a) => a.dashed)).toHaveLength(1);
  });
  it('puts heap blocks to the right of the stack and every box inside the picture', () => {
    const lay = layoutMemory(end(ok('int* h = new int[3];')));
    const heap = lay.boxes.find((b) => b.heap)!;
    const stack = lay.boxes.find((b) => !b.heap)!;
    expect(heap.x).toBeGreaterThan(stack.x);
    for (const b of lay.boxes) expect(b.x + b.block.cells.length * 74).toBeLessThanOrEqual(lay.width);
  });
  it('draws text for the values and describes itself', () => {
    const svg = memorySvg(end(ok('int x = 5;')), PAGE, labels, 'Memory at step 1');
    expect(svg).toContain('>5</text>');
    expect(svg).toContain('aria-label="Memory at step 1"');
  });
  it('escapes what a program prints into the picture', () => {
    const r = ok("char c = '<';");
    expect(memorySvg(end(r), PAGE, labels, 'alt')).not.toContain('<</text>');
  });
});

describe('the tracer strings', () => {
  const words = en.kitDesign.memtrace;
  it('has a sentence for every warning, stop, failure and step kind', () => {
    const warns: WarnKind[] = [
      'uninitialized',
      'outOfBounds',
      'useAfterDelete',
      'doubleDelete',
      'nullDeref',
      'leak',
      'dangling',
      'divideByZero',
      'badDelete',
      'overflow',
      'stepCap',
      'noReturn',
      'badShift',
      'literalWrite',
    ];
    for (const k of warns) expect(words.warn[k], k).toBeTypeOf('string');
    for (const k of ['statement', 'condition', 'call', 'return', 'end'])
      expect(words.kind[k as keyof typeof words.kind], k).toBeTypeOf('string');
    expect(words.stop.error).toBeTypeOf('string');
    expect(words.failure.syntax).toBeTypeOf('string');
  });
});
