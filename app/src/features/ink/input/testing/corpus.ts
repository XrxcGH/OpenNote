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
import { applies, generate, SCENARIOS } from './scenarios';
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

export interface CorpusRun {
  readonly byProfile: Map<string, Tally>;
  /** Wall time per replayed event, microseconds, per profile: the whole pipeline with a recording host. */
  readonly usPerEvent: Map<string, number>;
  /** Scenario and profile pairs with any stray action or missed intent, for the report. */
  readonly failures: string[];
}

/** Replays the corpus and tallies it per profile. */
export function runCorpus(fixtures: readonly Session[], seeds = CORPUS_SEEDS): CorpusRun {
  const byProfile = new Map<string, Tally>();
  const time = new Map<string, { ms: number; events: number }>();
  const failures: string[] = [];
  const add = (session: Session) => {
    const id = session.header.profile;
    const tally = byProfile.get(id) ?? emptyTally();
    byProfile.set(id, tally);
    const before = { ...tally };
    const started = performance.now();
    const result = replaySession(session);
    const spent = time.get(id) ?? { ms: 0, events: 0 };
    spent.ms += performance.now() - started;
    spent.events += session.events.length;
    time.set(id, spent);
    score(session, result, tally);
    const worse =
      tally.strayInk + tally.strayCamera + tally.strayTaps + tally.strayGestures + tally.inkDropped + tally.navMissed >
      before.strayInk +
        before.strayCamera +
        before.strayTaps +
        before.strayGestures +
        before.inkDropped +
        before.navMissed;
    if (worse) failures.push(`${session.header.task} on ${id}`);
  };
  for (const scenario of SCENARIOS) {
    for (const profile of PROFILES) {
      if (!applies(scenario, profile)) continue;
      for (let seed = 1; seed <= seeds; seed++) add(generate(scenario, profile, seed));
    }
  }
  for (const session of fixtures) add(session);
  const usPerEvent = new Map([...time].map(([id, t]) => [id, (t.ms * 1000) / Math.max(1, t.events)]));
  return { byProfile, usPerEvent, failures };
}
