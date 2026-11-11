// Hostile and large inputs (DESIGN 10.2, lane code:L12). Completion runs on the main thread after each key. A pasted
// or opened file must never stall it. Long runs of spaces, very long lines, and very large files each finish within
// a small bound, and the list stays short.
import { pythonLanguage } from '@codemirror/lang-python';
import { describe, expect, it } from 'vitest';
import { contextAt } from './ghost';
import { predict } from './pattern';
import { MAX_ITEMS, rank } from './rank';

/** Milliseconds one call takes. */
function timed(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

const listAfter = (language: string, text: string) => rank(contextAt(language, text, text.length));

describe('hostile lines before a member access', () => {
  const spaces = ' '.repeat(5000);

  it('stays fast in Python, JavaScript, and C++', () => {
    const cases: Array<[string, string]> = [
      ['python', `self: ${spaces}\nself.`],
      ['python', `self: list${spaces}x\nself.`],
      ['python', `${`self: ${' '.repeat(200)}x\n`.repeat(200)}self.`],
      ['javascript', `let self${spaces}: x${spaces}\nself.`],
      ['javascript', `const self:${spaces}x${spaces}\nself.`],
      ['cpp', `vector${spaces}${'vector <a '.repeat(500)}\nself.`],
      ['cpp', `std::vector${spaces}&${spaces}x\nself.`],
    ];
    for (const [language, text] of cases) expect(timed(() => listAfter(language, text))).toBeLessThan(100);
  });

  it('reads a type from a line of ordinary length after a hostile one', () => {
    const text = `nums: ${' '.repeat(5000)}\nnums = [1, 2]\nnums.`;
    expect(listAfter('python', text).map((item) => item.label)).toContain('append');
  });
});

describe('large files', () => {
  const lines: string[] = [];
  for (let i = 0; i < 60_000; i++) lines.push(`value_${i} = compute_${i}(value_${i - 1}) + offset`);
  const big = lines.join('\n');

  it('caps the list and answers quickly in a 60,000-line file', () => {
    const general = `${big}\nval`;
    const items = listAfter('python', general);
    expect(items.length).toBeLessThanOrEqual(MAX_ITEMS);
    expect(items.length).toBeGreaterThan(0);
    expect(timed(() => listAfter('python', `${big}\nva`))).toBeLessThan(150);
    expect(timed(() => listAfter('python', `${big}\nunknown.`))).toBeLessThan(150);
  });

  it('caps the scope walk with a tree', () => {
    const text = `${big}\ndef last(radius):\n    return rad`;
    const tree = pythonLanguage.parser.parse(text);
    rank(contextAt('python', text, text.length), { tree });
    const longer = `${text}i`;
    const fresh = pythonLanguage.parser.parse(longer);
    let top = '';
    expect(
      timed(() => (top = rank(contextAt('python', longer, longer.length), { tree: fresh })[0]!.label)),
    ).toBeLessThan(150);
    expect(top).toBe('radius');
  }, 60_000);

  it('reads a bounded window next to a multi-megabyte line', () => {
    const dump = `CREATE TABLE big (a INT);\nINSERT INTO big VALUES ${'(1),'.repeat(1_750_000)}(1);\n`;
    const select = `${dump}SELECT * FROM `;
    const other = `${dump}x = 1\nx`;
    // The editor's document text is one flat string; a search flattens the joined test texts the same way.
    select.indexOf('\u0001');
    other.indexOf('\u0001');
    expect(timed(() => predict('sql', select, select.length, false))).toBeLessThan(50);
    expect(timed(() => predict('python', other, other.length, true))).toBeLessThan(15);
  });

  it('keeps the pattern rules fast on long lines', () => {
    const arrows = `def f(x) ${') -> '.repeat(16_000)}`;
    expect(timed(() => predict('python', arrows, arrows.length, true))).toBeLessThan(50);
    const run = `${'a1 = 1\n'.repeat(3)}${'x'.repeat(100_000)}`;
    expect(timed(() => predict('python', run, run.length, true))).toBeLessThan(50);
  });
});
