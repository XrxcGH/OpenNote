// The accuracy corpus: every scenario on every profile it applies to, for a fixed set of seeds, plus the labeled
// recordings in `tests/fixtures/palm`. One function runs it and returns a tally per profile, so the CI gate, the
// report, and a developer's probe measure the same thing.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { emptyTally, score } from './metrics';
import type { Tally } from './metrics';
import { PROFILES } from './profiles';
import { replaySession } from './replay';
import { applies, generate, handsOf, SCENARIOS } from './scenarios';
import { parseSession } from './session';
import type { Session } from './session';

export const CORPUS_SEEDS = 4;

/** Every `*.session.jsonl` or `*.session.jsonl.gz` file under a folder, parsed. */
export function readFixtures(folder: string): { file: string; bytes: number; session: Session }[] {
  const out: { file: string; bytes: number; session: Session }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.session\.jsonl(\.gz)?$/.test(name)) {
        const raw = readFileSync(path);
        const text = name.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
        out.push({ file: path, bytes: raw.length, session: parseSession(text) });
      }
    }
  };
  walk(folder);
  return out;
}

/** A scenario whose sessions on some profiles no signal a page can see gets right: replayed and reported, not gated. */
export interface KnownLimit {
  readonly scenario: string;
  readonly profiles: readonly string[];
  readonly why: string;
}

export interface CorpusRun {
  readonly byProfile: Map<string, Tally>;
  /** Known limits, by `scenario on profile`: tallied apart from the gates, for the report. */
  readonly limited: Map<string, Tally>;
  /** Wall time per replayed event, microseconds, per profile: the whole pipeline with a recording host. */
  readonly usPerEvent: Map<string, number>;
  /** Scenario and profile pairs with any stray action or missed intent, for the report. */
  readonly failures: string[];
}

/** Replays the corpus and tallies it per profile, with the known limits apart. */
export function runCorpus(
  fixtures: readonly Session[],
  seeds = CORPUS_SEEDS,
  limits: readonly KnownLimit[] = [],
): CorpusRun {
  const byProfile = new Map<string, Tally>();
  const limited = new Map<string, Tally>();
  const time = new Map<string, { ms: number; events: number }>();
  const failures: string[] = [];
  const isLimit = (scenario: string, profile: string) =>
    limits.some((l) => l.scenario === scenario && l.profiles.includes(profile));
  const add = (session: Session, limit = false) => {
    const id = session.header.profile;
    const into = limit ? limited : byProfile;
    const key = limit ? `${session.header.task} on ${id}` : id;
    const tally = into.get(key) ?? emptyTally();
    into.set(key, tally);
    const labeled = `labeled limits on ${id}`;
    const apart = limited.get(labeled) ?? emptyTally();
    limited.set(labeled, apart);
    const before = { ...tally };
    const started = performance.now();
    const result = replaySession(session);
    const spent = time.get(id) ?? { ms: 0, events: 0 };
    spent.ms += performance.now() - started;
    spent.events += session.events.length;
    time.set(id, spent);
    if (session.labels.some((l) => l.limit !== undefined)) apart.sessions++;
    score(session, result, tally, apart);
    const bad = (x: Tally) =>
      x.strayInk +
      x.strayCamera +
      x.revertedCamera +
      x.strayTaps +
      x.strayGestures +
      x.inkDropped +
      x.navMissed +
      x.tapMissed +
      x.gestureMissed;
    if (!limit && bad(tally) > bad(before)) {
      failures.push(`${session.header.task} (${session.header.handedness}) on ${id}`);
    }
  };
  for (const scenario of SCENARIOS) {
    for (const profile of PROFILES) {
      if (!applies(scenario, profile)) continue;
      const limit = isLimit(scenario.name, profile.id);
      // Finger and stylus sessions are short, so they get more seeds for a comparable number of contacts.
      const n = profile.stylus === 'pen' ? seeds : seeds * 4;
      for (const hand of handsOf(scenario))
        for (let seed = 1; seed <= n; seed++) add(generate(scenario, profile, seed, hand), limit);
    }
  }
  for (const session of fixtures) add(session);
  const usPerEvent = new Map([...time].map(([id, t]) => [id, (t.ms * 1000) / Math.max(1, t.events)]));
  return { byProfile, limited, usPerEvent, failures };
}
