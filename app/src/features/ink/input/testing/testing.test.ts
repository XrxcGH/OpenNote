// The measurement tools themselves: the session format round-trips and validates, the generators are deterministic,
// the label oracle holds for random scenarios, profiles, and seeds, and palm verdicts survive within-frame
// reordering of delivery.

import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { emptyTally, gateValues, score, wilsonUpper } from './metrics';
import { PROFILES } from './profiles';
import { replaySession } from './replay';
import type { ReplayResult } from './replay';
import { applies, generate, SCENARIOS } from './scenarios';
import {
  EVENT_TYPES,
  INTENTS,
  LABEL_CLASSES,
  labelOf,
  parseSession,
  serializeSession,
  validateSession,
} from './session';
import type { Session } from './session';
import { reorderWithinFrames, seeded } from './writer';
import { LIMITS, RANGES } from './hands';
import { palmThresholds as K } from '../palm/index';

const LIMITS_FILE = new URL('../../../../../../tests/fixtures/palm/known-limits.json', import.meta.url);
const known = JSON.parse(readFileSync(LIMITS_FILE, 'utf8')) as {
  scenarios: { scenario: string; profiles: string[] }[];
};
const limited = (s: string, p: string) => known.scenarios.some((l) => l.scenario === s && l.profiles.includes(p));
/** Every scenario and profile pair but the known limits. */
const pairs = SCENARIOS.flatMap((s) =>
  PROFILES.filter((p) => applies(s, p) && !limited(s.name, p.id)).map((p) => ({ s, p })),
);

describe('the labeled session format', () => {
  it('round-trips a generated session and validates it', () => {
    const session = generate(SCENARIOS[0], PROFILES[0], 1);
    const back = parseSession(serializeSession(session));
    expect(back).toEqual(session);
    expect(validateSession(back)).toEqual([]);
  });

  it('reports a session that breaks the schema', () => {
    const session = generate(SCENARIOS[0], PROFILES[0], 1);
    const broken: Session = {
      ...session,
      header: { ...session.header, consent: false },
      events: [session.events[1], session.events[0]],
    };
    expect(validateSession(broken)).toEqual(['header: consent', 'event 0: seq out of order']);
    expect(() => parseSession('{"format"\n')).toThrow('line 1');
  });

  it('generates the same session from the same seed, and labels every contact', () => {
    const a = generate(SCENARIOS[1], PROFILES[2], 7);
    expect(serializeSession(generate(SCENARIOS[1], PROFILES[2], 7))).toBe(serializeSession(a));
    const touches = new Set(a.events.filter((e) => e.pt === 'touch').map((e) => e.id));
    for (const id of touches) expect(labelOf(a, id!)).toBeDefined();
  });

  it('agrees with the JSON Schema on event types, label classes, and intents', () => {
    const url = new URL('../../../../../../tests/fixtures/palm/session.schema.json', import.meta.url);
    const schema = JSON.parse(readFileSync(url, 'utf8'));
    expect(schema.$defs.event.properties.type.enum).toEqual(EVENT_TYPES);
    expect(schema.$defs.label.properties.cls.enum).toEqual(LABEL_CLASSES);
    expect(schema.$defs.label.properties.intent.enum).toEqual(INTENTS);
  });

  it('bounds a rate with a Wilson interval', () => {
    expect(wilsonUpper(0, 0)).toBe(0);
    expect(wilsonUpper(0, 100)).toBeCloseTo(0.037, 3);
    expect(wilsonUpper(50, 100)).toBeCloseTo(0.596, 3);
  });
});

/** True when no contact labeled with no intent did anything a person would see. */
function oracleHolds(session: Session, result: ReplayResult): string[] {
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

describe('the label oracle', () => {
  it('holds for random scenarios, profiles, and seeds, and every intent is achieved', () => {
    fc.assert(
      fc.property(fc.constantFrom(...pairs), fc.integer({ min: 1, max: 100_000 }), ({ s, p }, seed) => {
        const session = generate(s, p, seed);
        const result = replaySession(session);
        expect(oracleHolds(session, result)).toEqual([]);
        const g = gateValues(score(session, result, emptyTally(), emptyTally()));
        expect(g.G7_inkDroppedRate + g.G8_navMissedRate + g.G8_tapsMissed + g.G5_penLost).toBe(0);
      }),
      { numRuns: 60 },
    );
  });

  it("keeps the other hand's taps on a control clear of the writing hand's wider reach", () => {
    // CI seed 1550817018 (case 5): a tap on a control 110 ms after the pen lifted landed where the pipeline's hand region
    // still reaches, so it was refused as a palm's. About 3 percent of this scenario's seeds did the same; seed 6 is one.
    const s = SCENARIOS.find((x) => x.name === 'otherHandChromeTap')!;
    const p = PROFILES.find((x) => x.id === 'oem-mpp')!;
    for (const seed of [6, 9, 13, 52, 63]) {
      const session = generate(s, p, seed);
      const result = replaySession(session);
      expect(oracleHolds(session, result)).toEqual([]);
      const g = gateValues(score(session, result, emptyTally(), emptyTally()));
      expect(g.G8_tapsMissed).toBe(0);
    }
  });

  it('labels a heel paired with a fingertip-sized part as uncertain as the part', () => {
    // CI seed 9 (iPhone, one finger): the heel and a fingertip-sized part beside it read as two fingers panning, which the
    // part's own label allowed but the heel's did not.
    const s = SCENARIOS.find((x) => x.name === 'loneRest')!;
    const p = PROFILES.find((x) => x.id === 'iphone-finger')!;
    const session = generate(s, p, 9);
    const shuffled = reorderWithinFrames(session, seeded(9));
    expect(oracleHolds(shuffled, replaySession(shuffled))).toEqual([]);
  });

  it("keeps the other hand's taps off the place an overwriter's palm rested", () => {
    // CI seed 1664849986 (case 5931): the model put an overwriter's heel below the pen, but the palm rests above it, so a tap
    // 11 mm from where the palm had rested was labeled another hand's and the pipeline rightly refused it.
    const s = SCENARIOS.find((x) => x.name === 'gestureAfterPen')!;
    const p = PROFILES.find((x) => x.id === 'oem-mpp')!;
    const session = generate(s, p, 5931);
    const result = replaySession(session);
    expect(oracleHolds(session, result)).toEqual([]);
    const g = gateValues(score(session, result, emptyTally(), emptyTally()));
    expect(g.G8_tapsMissed).toBe(0);
  });

  it("keeps a finger that writes after the pen out of the writing hand's reach", () => {
    // CI run seed -898763053 (case 14): a finger wrote 45 mm below the pen's last point, inside the hooked grip's reach.
    const s = SCENARIOS.find((x) => x.name === 'fingerAfterPen')!;
    const p = PROFILES.find((x) => x.id === 'wacom-emr-mouse')!;
    const session = generate(s, p, 14);
    const result = replaySession(session);
    expect(oracleHolds(session, result)).toEqual([]);
    const g = gateValues(score(session, result, emptyTally(), emptyTally()));
    expect(g.G7_inkDroppedRate).toBe(0);
  });

  it('labels a palm whose noisy travel reaches the settle bound as a slide, whichever way the noise points', () => {
    // CI seed 99990: a lone rest drifting 9.4 mm read 10.07 mm to the filter once the noise of both ends was added.
    const s = SCENARIOS.find((x) => x.name === 'loneRest')!;
    const p = PROFILES.find((x) => x.id === 'phone-finger')!;
    const session = generate(s, p, 99_990);
    const result = replaySession(session);
    expect(oracleHolds(session, result)).toEqual([]);
    expect(session.labels.some((l) => l.limit === 'slides-like-a-stroke')).toBe(true);
  });

  it('gives labeled palms the same outcome when events in a frame arrive in another order', () => {
    fc.assert(
      fc.property(fc.constantFrom(...pairs), fc.integer({ min: 1, max: 100_000 }), ({ s, p }, seed) => {
        const session = generate(s, p, seed);
        const shuffled = reorderWithinFrames(session, seeded(seed));
        const a = replaySession(session);
        const b = replaySession(shuffled);
        expect(oracleHolds(shuffled, b)).toEqual([]);
        for (const [id, c] of a.contacts) {
          const label = labelOf(session, id);
          if (label?.intent !== 'none' || label.limit !== undefined) continue;
          const other = b.contacts.get(id)!;
          expect([other.committedAt > 0 && !other.uncommitted, other.tapAllowed]).toEqual([
            c.committedAt > 0 && !c.uncommitted,
            c.tapAllowed,
          ]);
        }
      }),
      { numRuns: 30 },
    );
  });
});

/** Whether a range reaches below `lo` and above `hi` of the thresholds it must straddle. */
const straddles = (range: readonly [number, number], ...marks: number[]) =>
  marks.every((m) => range[0] < m && range[1] > m);

describe('the generators', () => {
  it('draw every range across each threshold it meets, not inside the classifier', () => {
    // Palm drift crosses slop (taps and long presses) and a settling palm's travel (scroll, stroke).
    expect(straddles(RANGES.palmDriftMm, K.SLOP_MM, K.SETTLE_TRAVEL_MM)).toBe(true);
    // Final palm size crosses a fingertip, a thumb, and a palm.
    expect(straddles(RANGES.palmMajorMm, K.FINGERTIP_MAJOR_MM, K.LARGE_MAJOR_MM, K.PALM_MAJOR_MM)).toBe(true);
    // The other hand acts from the moment the pen lifts, across both E8 windows.
    expect(straddles(RANGES.afterUpMs, K.AFTER_PEN_CANCEL_MS, K.AFTER_PEN_HOLD_MS)).toBe(true);
    expect(RANGES.afterUpMs[0]).toBe(0);
    // Multi-finger taps from the design's one second after the pen, across the 20 s of presence recent.
    expect(straddles(RANGES.gestureAfterPenMs, K.RECENT_MS)).toBe(true);
    // Tap fingers from just over the minimum spacing to well past where a palm's parts sit.
    expect(RANGES.tapSpacingMm[0]).toBeLessThan(K.TAP_MIN_MM + 1);
    expect(RANGES.tapSpacingMm[1]).toBeGreaterThan(K.SPLIT_MM + K.CLUSTER_MM / 4);
    expect(RANGES.palmParts).toEqual([1, 3]);
  });

  it('run every scenario with each hand and the seeds through all four grips', () => {
    const grips = new Set([1, 2, 3, 4].map((seed) => generate(SCENARIOS[0], PROFILES[0], seed).header.grip));
    expect(grips.size).toBe(4);
    const left = SCENARIOS.filter((s) => s.kind === 'touch').map((s) => generate(s, PROFILES.at(-1)!, 1, 'left'));
    expect(left.every((x) => x.header.handedness === 'left')).toBe(true);
  });

  it('list every known limit a generated contact can carry in known-limits.json', () => {
    const file = JSON.parse(readFileSync(LIMITS_FILE, 'utf8')) as { labels: Record<string, string> };
    expect(Object.keys(file.labels).sort()).toEqual(Object.keys(LIMITS).sort());
  });
});
