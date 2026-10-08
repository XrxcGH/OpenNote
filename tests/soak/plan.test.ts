import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { judge, pickAction, seeded, someWords, soakMinutes, WEIGHTS } from './plan.ts';
import type { Sample } from './plan.ts';

const MB = 1024 * 1024;

function samples(count: number, make: (i: number) => Partial<Sample>): Sample[] {
  return Array.from({ length: count }, (_, i) => ({
    minute: i,
    heap: 100 * MB,
    nodes: 10_000,
    listeners: 500,
    probeMs: 1000,
    actions: i * 100,
    ...make(i),
  }));
}

describe('the soak plan', () => {
  it('gives the same actions for the same seed, and different ones for another', () => {
    const run = (seed: number) => {
      const random = seeded(seed);
      return Array.from({ length: 50 }, () => pickAction(random));
    };
    assert.deepEqual(run(1), run(1));
    assert.notDeepEqual(run(1), run(2));
  });

  it('draws every action, in about the proportions of the weights', () => {
    const random = seeded(7);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 20_000; i += 1) {
      const id = pickAction(random);
      counts[id] = (counts[id] ?? 0) + 1;
    }
    for (const id of Object.keys(WEIGHTS)) assert.ok((counts[id] ?? 0) > 0, `${id} never came up`);
    assert.ok(counts.type > counts.heading * 5);
  });

  it('types one to six words', () => {
    const random = seeded(3);
    for (let i = 0; i < 100; i += 1) {
      const words = someWords(random).split(' ').length;
      assert.ok(words >= 1 && words <= 6);
    }
  });

  it('reads the length from the environment', () => {
    assert.equal(soakMinutes(undefined), 120);
    assert.equal(soakMinutes('2'), 2);
    assert.throws(() => soakMinutes('soon'));
    assert.throws(() => soakMinutes('0'));
  });
});

describe('the soak verdict', () => {
  it('passes flat lines', () => {
    assert.equal(
      judge(
        samples(40, () => ({})),
        [],
      ).ok,
      true,
    );
  });

  it('passes a little noise', () => {
    const noisy = samples(40, (i) => ({ heap: (100 + (i % 3)) * MB, probeMs: 1000 + (i % 5) * 20 }));
    assert.equal(judge(noisy, []).ok, true);
  });

  it('fails memory that keeps growing', () => {
    const verdict = judge(
      samples(40, (i) => ({ heap: (100 + i * 5) * MB })),
      [],
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join(' '), /Memory grew/);
  });

  it('does not fail a large fraction of a small number', () => {
    const verdict = judge(
      samples(40, (i) => ({ heap: (10 + i * 0.5) * MB })),
      [],
    );
    assert.equal(verdict.ok, true);
  });

  it('fails typing that slows down', () => {
    const verdict = judge(
      samples(40, (i) => ({ probeMs: 1000 + i * 40 })),
      [],
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join(' '), /slowed down/);
  });

  it('fails nodes that pile up', () => {
    const verdict = judge(
      samples(40, (i) => ({ nodes: 10_000 + i * 500 })),
      [],
    );
    assert.match(verdict.problems.join(' '), /nodes/);
  });

  it('fails any crash, however flat the lines', () => {
    const verdict = judge(
      samples(40, () => ({})),
      ['The renderer crashed'],
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /Crash: The renderer crashed/);
  });

  it('says so when there are too few samples to show a trend', () => {
    const verdict = judge(
      samples(3, () => ({})),
      [],
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /Only 3 samples/);
  });
});

describe('the soak summary', () => {
  it('keeps about ten rows, the last sample, and the problems', async () => {
    const { summary } = await import('./summary.ts');
    const all = samples(100, (i) => ({ heap: (100 + i) * MB }));
    const text = summary({
      minutes: 100,
      seed: 4,
      actions: 9000,
      verdict: judge(all, ['The renderer crashed']),
      samples: all,
    });
    const rows = text.split('\n').filter((line) => /^\| \d/.test(line));
    assert.ok(rows.length >= 10 && rows.length <= 11, String(rows.length));
    assert.match(rows.at(-1) ?? '', /^\| 99 /);
    assert.match(text, /failed/);
    assert.match(text, /- Crash: The renderer crashed/);
  });
});
