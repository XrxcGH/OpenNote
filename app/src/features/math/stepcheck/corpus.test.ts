// The worked-solution corpus is tests/fixtures/stepcheck/corpus.json, built by generate.ts there. No correct step
// may be called broken: not in a correct solution, and not before the slip in a broken one. At least 90% of the
// slips must be found. The test prints both rates.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkSteps } from './index';

interface Case {
  id: string;
  topic: string;
  lines: string[];
  broken?: number;
}

const corpus = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../../tests/fixtures/stepcheck/corpus.json', import.meta.url)), 'utf8'),
) as { correct: Case[]; broken: Case[] };

describe('the step-checking corpus', () => {
  it('has at least 150 correct and 150 broken worked solutions', () => {
    expect(corpus.correct.length).toBeGreaterThanOrEqual(150);
    expect(corpus.broken.length).toBeGreaterThanOrEqual(150);
  });

  it('never calls a correct step wrong, and finds at least 90% of the broken steps', () => {
    const falsePositives: string[] = [];
    const missed: string[] = [];
    let correctSteps = 0;
    for (const c of corpus.correct) {
      const results = checkSteps(c.lines);
      correctSteps += results.length;
      for (const r of results) if (r.verdict === 'broken') falsePositives.push(`${c.id} line ${r.index}: ${r.reason}`);
    }
    let found = 0;
    for (const c of corpus.broken) {
      const results = checkSteps(c.lines);
      const at = c.broken ?? -1;
      correctSteps += at;
      for (const r of results.slice(0, at)) {
        if (r.verdict === 'broken') falsePositives.push(`${c.id} line ${r.index}: ${r.reason}`);
      }
      if (results[at]?.verdict === 'broken') found += 1;
      else missed.push(`${c.id} line ${at}: ${results[at]?.verdict} ${results[at]?.reason}`);
    }
    const falseRate = falsePositives.length / correctSteps;
    const detection = found / corpus.broken.length;
    process.stdout.write(
      `\nstep-check corpus: ${corpus.correct.length} correct, ${corpus.broken.length} broken; ` +
        `false positives ${falsePositives.length}/${correctSteps} steps (${(falseRate * 100).toFixed(2)}%); ` +
        `detection ${found}/${corpus.broken.length} (${(detection * 100).toFixed(1)}%)\n` +
        (missed.length ? `missed:\n  ${missed.join('\n  ')}\n` : ''),
    );
    expect(falsePositives).toEqual([]);
    expect(detection).toBeGreaterThanOrEqual(0.9);
  }, 120_000);
});
