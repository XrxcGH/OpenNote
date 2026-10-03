// The palm rejection accuracy gate. It replays every scenario on every device profile through the shipped pipeline,
// together with the labeled recordings in tests/fixtures/palm. It fails when a gate in thresholds.json is missed,
// when a profile does worse than its recorded baseline, or when a gate is looser than the design allows. Set
// OPENNOTE_PALM_REPORT to a file path to write the per-profile table (docs/perf/palm-accuracy.md), and
// OPENNOTE_PALM_BASELINE=write to tighten the baseline to what was measured.

import { readFileSync, writeFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gateValues, merge, emptyTally, wilsonUpper } from './testing/metrics';
import type { Tally } from './testing/metrics';
import { runCorpus, readFixtures } from './testing/corpus';
import type { CorpusRun } from './testing/corpus';
import { MAX_FIXTURE_BYTES, validateSession } from './testing/session';
import { PROFILES } from './testing/profiles';

const FIXTURES = fileURLToPath(new URL('../../../../../tests/fixtures/palm/', import.meta.url));
const THRESHOLDS = `${FIXTURES}thresholds.json`;

interface Thresholds {
  gates: Record<string, number>;
  baseline: Record<string, Record<string, number>>;
  knownLimitsMax: number;
}

/** The design's gates (palm README, "Measurement"). thresholds.json may only be as strict or stricter. */
const CEILINGS: Record<string, number> = {
  G1_strayInk: 0,
  G2_strayShownPen: 0,
  G2_strayShownTouchRate: 0.01,
  G2_strayShownMs: 500,
  G3_strayCamera: 0,
  G4_strayTaps: 0,
  G5_penLost: 0,
  G7_inkDroppedRate: 0.001,
  G7_inkTruncated: 0,
  G8_navMissedRate: 0.01,
  G8_tapsMissed: 0,
  G9_navDelayP95: 600,
  G10_commitDelayAbsent: 0,
  G10_commitDelay: 532,
  G11_strayPerStroke: 0.016,
};

const thresholds = JSON.parse(readFileSync(THRESHOLDS, 'utf8')) as Thresholds;
const fixtures = readFixtures(FIXTURES);
const limits = JSON.parse(readFileSync(`${FIXTURES}known-limits.json`, 'utf8')) as { sessions: string[] };
const gated = fixtures.filter((f) => !limits.sessions.some((name) => f.file.split(sep).join('/').endsWith(name)));
let run: CorpusRun | null = null;
const corpus = () => (run ??= runCorpus(gated.map((f) => f.session)));

describe('the palm accuracy corpus', () => {
  it('holds only valid labeled sessions under 1 MB', () => {
    for (const f of fixtures) {
      expect(f.bytes, f.file).toBeLessThanOrEqual(MAX_FIXTURE_BYTES);
      expect(validateSession(f.session), f.file).toEqual([]);
    }
    expect(limits.sessions.length).toBeLessThanOrEqual(thresholds.knownLimitsMax);
  });

  it('keeps every gate at or below the design', () => {
    for (const [gate, ceiling] of Object.entries(CEILINGS))
      expect(thresholds.gates[gate], gate).toBeLessThanOrEqual(ceiling);
  });

  it('meets every gate on every device profile', { timeout: 300_000 }, () => {
    const { byProfile, failures } = corpus();
    expect(failures).toEqual([]);
    for (const profile of PROFILES) {
      const tally = byProfile.get(profile.id);
      expect(tally, profile.id).toBeDefined();
      const values = gateValues(tally!);
      for (const [gate, limit] of Object.entries(thresholds.gates)) {
        expect(values[gate], `${gate} on ${profile.id}`).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('does no worse than the recorded baseline on any profile', { timeout: 300_000 }, () => {
    const { byProfile } = corpus();
    const write = process.env.OPENNOTE_PALM_BASELINE === 'write';
    for (const [id, tally] of byProfile) {
      const values = gateValues(tally);
      const base = (thresholds.baseline[id] ??= {});
      for (const [gate, value] of Object.entries(values)) {
        if (write) base[gate] = Math.min(base[gate] ?? Infinity, round(value));
        else
          expect(round(value), `${gate} on ${id} rose above its baseline`).toBeLessThanOrEqual(base[gate] ?? Infinity);
      }
    }
    if (write) writeFileSync(THRESHOLDS, `${JSON.stringify(thresholds, null, 2)}\n`);
    const out = process.env.OPENNOTE_PALM_REPORT;
    if (out) writeFileSync(out, report(corpus()));
  });
});

const round = (v: number) => Math.round(v * 10_000) / 10_000;
const pct = (k: number, n: number) =>
  n === 0 ? 'n/a' : `${((100 * k) / n).toFixed(1)}% (≤${(100 * wilsonUpper(k, n)).toFixed(1)}%)`;

/** The per-profile table for docs/perf/palm-accuracy.md. */
function report({ byProfile, usPerEvent }: CorpusRun): string {
  const rows = PROFILES.map((p) => {
    const t: Tally = byProfile.get(p.id) ?? emptyTally();
    const g = gateValues(t);
    const lost = t.inkDropped + t.navMissed + t.tapMissed + t.gestureMissed;
    const meant = t.intendedInk + t.intendedNav + t.intendedTap + t.intendedGestures;
    const cells = [
      p.id,
      t.sessions,
      t.penStrokes,
      t.nonIntent,
      t.strayInk,
      pct(t.strayInk + t.strayCamera + t.strayTaps, t.nonIntent),
      pct(lost, meant),
      g.G2_strayShownMs.toFixed(0),
      t.lateRetracts,
      g.G10_commitDelay.toFixed(0),
      g.G11_strayPerStroke.toFixed(4),
      (usPerEvent.get(p.id) ?? 0).toFixed(1),
    ];
    return `| ${cells.join(' | ')} |`;
  });
  const all = [...byProfile.values()].reduce(merge, emptyTally());
  const meant = all.intendedInk + all.intendedNav + all.intendedTap + all.intendedGestures;
  const total = `Total: ${all.sessions} sessions, ${all.penStrokes} pen strokes, ${all.nonIntent} non-intent contacts`;
  return `${rows.join('\n')}\n\n${total}, ${meant} intended touch actions.\n`;
}
