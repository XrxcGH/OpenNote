// The label oracle: what a replay of a generated session must and must not do by its labels. The property test and
// the seed sweep share it. A contact labeled with no intent and no known limit leaves no ink, moves no camera, and
// taps nothing. A session with no gesture intent and no limit raises no gesture. Every intent is achieved.

import { emptyTally, gateValues, score } from './metrics';
import { PROFILES } from './profiles';
import { replaySession } from './replay';
import type { ReplayResult } from './replay';
import { applies, generate, SCENARIOS } from './scenarios';
import type { Scenario } from './scenarios';
import { labelOf } from './session';
import type { Session } from './session';
import type { SimProfile } from './profiles';

/** The problems a replay shows by the labels: none when no contact labeled with no intent did anything visible. */
export function oracleHolds(session: Session, result: ReplayResult): string[] {
  const problems: string[] = [];
  const mm = 1 / result.cssPxPerMm;
  for (const [id, c] of result.contacts) {
    const label = labelOf(session, id);
    if (!label || label.intent !== 'none' || label.limit !== undefined) continue;
    if (!Number.isNaN(c.committedAt) && !c.uncommitted) problems.push(`${id} committed ink`);
    if (Math.hypot(c.camX, c.camY) * mm > 1.5 || Math.abs(c.zoom - 1) > 0.01) problems.push(`${id} moved the camera`);
    if (c.tapAllowed || c.menuAllowed) problems.push(`${id} tapped`);
  }
  const limit = session.labels.some((l) => l.limit !== undefined);
  if (!limit && !session.labels.some((l) => l.intent === 'gesture') && result.gestures.length > 0) {
    problems.push('gesture');
  }
  return problems;
}

/** The intents a replay lost: ink dropped, navigation missed, taps missed, and pen lost, by the gates. */
export function intentsLost(session: Session, result: ReplayResult): string[] {
  const g = gateValues(score(session, result, emptyTally(), emptyTally()));
  const lost: string[] = [];
  if (g.G7_inkDroppedRate > 0) lost.push('ink dropped');
  if (g.G8_navMissedRate > 0) lost.push('navigation missed');
  if (g.G8_tapsMissed > 0) lost.push('tap missed');
  if (g.G5_penLost > 0) lost.push('pen lost');
  return lost;
}

export interface OraclePair {
  s: Scenario;
  p: SimProfile;
}

/** Every scenario and profile pair the oracle holds for: all that apply, but those known-limits.json lists. */
export function oraclePairs(known: { scenarios: { scenario: string; profiles: string[] }[] }): OraclePair[] {
  const limited = (s: string, p: string) => known.scenarios.some((l) => l.scenario === s && l.profiles.includes(p));
  return SCENARIOS.flatMap((s) =>
    PROFILES.filter((p) => applies(s, p) && !limited(s.name, p.id)).map((p) => ({ s, p })),
  );
}

/** One sweep case: its pair, its generator seed, and what the oracle found, empty when it held. */
export interface SweepCase {
  /** Its index in the sweep (`caseAt`). */
  case: number;
  scenario: string;
  /** Pen or touch: a pen scenario and a touch scenario can share a name. */
  kind: Scenario['kind'];
  profile: string;
  seed: number;
  problems: string[];
}

/** The generator seeds the property test draws from. */
export const SEED_SPAN = 100_000;

/**
 * The pair and seed of case `i` of a sweep. Its seed is 1 + (i mod SEED_SPAN), so the sweep runs every seed the
 * property test can draw. Its pair strides through the list, so each seed meets another pair on each pass.
 */
export function caseAt(pairs: readonly OraclePair[], i: number): OraclePair & { seed: number } {
  const seed = 1 + (i % SEED_SPAN);
  const pass = Math.floor(i / SEED_SPAN);
  return { ...pairs[(seed * 7919 + pass * 104_729) % pairs.length], seed };
}

/** Runs case `i` of a sweep (`caseAt`) and reports what the oracle found. */
export function sweepCase(pairs: readonly OraclePair[], i: number): SweepCase {
  const { s, p, seed } = caseAt(pairs, i);
  const session = generate(s, p, seed);
  const result = replaySession(session);
  const problems = [...oracleHolds(session, result), ...intentsLost(session, result)];
  return { case: i, scenario: s.name, kind: s.kind, profile: p.id, seed, problems };
}
