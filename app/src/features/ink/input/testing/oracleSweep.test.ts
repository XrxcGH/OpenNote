// The label oracle's seed sweep runs case after case across every generator seed the property test can draw. A seed
// that fails is then found here, not by a random draw in CI. A short slice runs every time. The full sweep runs when
// PALM_SWEEP_TO is set: cases PALM_SWEEP_FROM to PALM_SWEEP_TO, with each failing case written to PALM_SWEEP_OUT.
//
// tests/fixtures/palm/oracle-sweep.json records what the last full sweep found. Each failing case is a generator gap
// or a classifier miss, written up in docs/testing/palm-sweep.md. A case still open is left out of the property tests'
// draws until it is fixed.

import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { oraclePairs, sweepCase } from './oracle';
import type { SweepCase } from './oracle';

const LIMITS_FILE = new URL('../../../../../../tests/fixtures/palm/known-limits.json', import.meta.url);
const SWEEP_FILE = new URL('../../../../../../tests/fixtures/palm/oracle-sweep.json', import.meta.url);
const pairs = oraclePairs(JSON.parse(readFileSync(LIMITS_FILE, 'utf8')));
const record = JSON.parse(readFileSync(SWEEP_FILE, 'utf8')) as {
  cases: number;
  pairs: number;
  failures: (Omit<SweepCase, 'problems'> & { class: 'generator' | 'classifier'; fixed: boolean; why: string })[];
};

const env = (name: string) => (typeof process === 'undefined' ? undefined : process.env[name]);
const to = Number(env('PALM_SWEEP_TO') ?? 0);

describe('the label oracle sweep', () => {
  it.runIf(to > 0)(
    'holds for every case of the full sweep',
    () => {
      const from = Number(env('PALM_SWEEP_FROM') ?? 0);
      const failed: SweepCase[] = [];
      for (let i = from; i < to; i++) {
        const c = sweepCase(pairs, i);
        if (c.problems.length > 0) failed.push(c);
      }
      const out = env('PALM_SWEEP_OUT');
      if (out) writeFileSync(out, JSON.stringify({ from, to, failed }, null, 1));
      expect(failed).toEqual([]);
    },
    24 * 3600_000,
  );

  it('ran over the pairs there are now, 200,000 cases or more', () => {
    // A new scenario or profile changes every case's pair: run the full sweep again and record what it finds.
    expect(record.pairs).toBe(pairs.length);
    expect(record.cases).toBeGreaterThanOrEqual(200_000);
  });

  it('holds for a slice of the sweep, but the open failures', { timeout: 120_000 }, () => {
    const open = new Set(record.failures.filter((f) => !f.fixed).map((f) => f.case));
    const failed: SweepCase[] = [];
    for (let i = 0; i < 200; i++) {
      const c = sweepCase(pairs, i * 997);
      if (c.problems.length > 0 && !open.has(c.case)) failed.push(c);
    }
    expect(failed).toEqual([]);
  });

  it(
    'holds for every failure the sweep found that is fixed, and still fails every one left open',
    { timeout: 300_000 },
    () => {
      for (const f of record.failures) {
        const c = sweepCase(pairs, f.case);
        expect([c.scenario, c.profile, c.seed], `case ${f.case}`).toEqual([f.scenario, f.profile, f.seed]);
        const what = `${f.scenario} on ${f.profile}, seed ${f.seed} (${f.class})`;
        if (f.fixed) expect(c.problems, what).toEqual([]);
        else expect(c.problems.length, what).toBeGreaterThan(0);
      }
    },
  );
});
