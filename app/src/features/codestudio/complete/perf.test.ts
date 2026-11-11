// Latency budgets (DESIGN 15, gate G-C2): the list under 20 ms and the pattern ghost text under 30 ms in a
// 1,000-line file. Every sample runs cold, as after a keystroke: the text is new and its tree is freshly parsed, so
// no per-text or per-tree cache can answer. The parse is not timed; the editor has the tree before it asks. Best of
// three runs of the median, so a busy test machine does not fail the gate on one slow sample.
import { pythonLanguage } from '@codemirror/lang-python';
import { describe, expect, it } from 'vitest';
import { contextAt, suggest } from './ghost';
import { rank } from './rank';
import type { SyntaxTree } from './scope';

function thousandLines(): string {
  const lines: string[] = [];
  for (let i = 0; lines.length < 995; i++) {
    lines.push(`def step_${i}(values, limit_${i}):`);
    lines.push(`    total_${i} = 0`);
    lines.push(`    for item in values:`);
    lines.push(`        total_${i} += item * ${i}`);
    lines.push(`    return min(total_${i}, limit_${i})`);
  }
  lines.push('def last(radius, count):', '    nums = [1, 2, 3]', '    result = radius * count', '    print(res');
  return lines.join('\n');
}

const SAMPLES = 15;

/** The median of cold samples: each one types a different character earlier in the file and reparses. */
function coldMedianMs(base: string, run: (text: string, tree: SyntaxTree) => void): number {
  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const at = base.indexOf('\n', (base.length * i) / SAMPLES);
    const text = `${base.slice(0, at)} # ${String.fromCharCode(97 + i)}${base.slice(at)}`;
    const tree = pythonLanguage.parser.parse(text);
    const start = performance.now();
    run(text, tree);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[SAMPLES >> 1]!;
}

const best = (base: string, run: (text: string, tree: SyntaxTree) => void): number =>
  Math.min(coldMedianMs(base, run), coldMedianMs(base, run), coldMedianMs(base, run));

describe('completion latency in a 1,000-line file', () => {
  const base = thousandLines();

  it('has 1,000 lines', () => {
    expect(base.split('\n').length).toBeGreaterThanOrEqual(999);
  });

  it('computes the list under 20 ms, cold', () => {
    const tree = pythonLanguage.parser.parse(base);
    expect(rank(contextAt('python', base, base.length), { tree })[0]?.label).toBe('result');
    const ms = best(base, (text, fresh) => rank(contextAt('python', text, text.length), { tree: fresh }));
    expect(ms).toBeLessThan(20);
  }, 60_000);

  it('keeps the word counts while typing on one line of a 300 KB file', () => {
    const lines: string[] = [];
    for (let i = 0; lines.join('\n').length < 300_000; i++) {
      for (let j = 0; j < 100; j++) lines.push(`value_${i % 8}_${j % 10} = compute(item_${j % 30}, limit) + offset`);
    }
    const middle = lines.length >> 1;
    const head = `${lines.slice(0, middle).join('\n')}\n`;
    const tail = `\n${lines.slice(middle).join('\n')}`;
    const typed = 'value_12_3';
    const times: number[] = [];
    for (let k = 1; k <= typed.length; k++) {
      const text = `${head}${typed.slice(0, k)}${tail}`;
      // The editor's document text is one flat string; a search flattens the joined test text the same way.
      text.indexOf('\u0001');
      const start = performance.now();
      rank(contextAt('python', text, head.length + k));
      times.push(performance.now() - start);
    }
    // The first keystroke on the line counts the window; every later one reuses those counts.
    const later = times.slice(1).sort((a, b) => a - b);
    expect(later[later.length >> 1]).toBeLessThan(2);
  });

  it('computes the ghost text under 30 ms, cold', () => {
    for (const explicit of [false, true]) {
      const ms = best(base, (text, tree) =>
        suggest({ language: 'python', text, pos: text.length, explicit }, { tree }),
      );
      expect(ms).toBeLessThan(30);
    }
  }, 60_000);
});
