// Traces from the fifth palm rejection review, replayed through the shipped pipeline on the device profiles the review
// used. Positions are millimeters on the glass. Each describe names the defect it guards.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_LEARNED, resolvePxPerMm } from './palm/index';
import type { DeviceProfile, PalmSettings } from './palm/index';
import { handCovers, heelOffset, palm, planWriting, writePlan } from './testing/hands';
import type { PenPlan } from './testing/hands';
import { emptyTally, score } from './testing/metrics';
import type { Tally } from './testing/metrics';
import { PEN_PROFILES, PROFILES, profileById } from './testing/profiles';
import type { SimProfile } from './testing/profiles';
import { replaySession } from './testing/replay';
import type { ContactOutcome, ReplayResult } from './testing/replay';
import { generate, PEN_SCENARIOS, TOUCH_SCENARIOS } from './testing/scenarios';
import type { Session } from './testing/session';
import { between, seeded, SessionWriter } from './testing/writer';
import type { Rand, Vec2 } from './testing/writer';

// The sweeps replay a few hundred sessions each.
vi.setConfig({ testTimeout: 120_000 });

const LIMITS = new URL('../../../../../tests/fixtures/palm/known-limits.json', import.meta.url);

interface Options {
  readonly settings?: Partial<PalmSettings>;
  readonly penSeen?: boolean;
  readonly hand?: 'right' | 'left';
  readonly device?: Partial<DeviceProfile>;
}

interface Run {
  readonly session: Session;
  readonly result: ReplayResult;
  readonly out: (id: number) => ContactOutcome;
  readonly tally: Tally;
}

function run(p: SimProfile, seed: number, build: (w: SessionWriter, r: Rand) => void, o: Options = {}): Run {
  const r = seeded(seed * 7919 + 29);
  const w = new SessionWriter(p, r, {
    handedness: o.hand ?? 'right',
    grip: 'tripod',
    settings: o.settings ?? {},
    learned: { ...EMPTY_LEARNED, penSeen: o.penSeen ?? p.stylus === 'pen' },
    task: 'trace',
  });
  w.tool(true, 0);
  build(w, r);
  const session = w.build();
  const result = replaySession(session, { profile: { ...p.device, ...o.device } });
  // Contacts the generators label as known limits are reported apart, as the accuracy gate does.
  const tally = score(session, result, emptyTally(), emptyTally());
  return { session, result, out: (id) => result.contacts.get(id)!, tally };
}

const BAD = [
  'strayInk',
  'strayShownPen',
  'strayCamera',
  'revertedCamera',
  'strayTaps',
  'strayGestures',
  'penLost',
  'inkDropped',
  'inkTruncated',
  'navMissed',
  'tapMissed',
  'gestureMissed',
] as const;

/** The faults of a run, as `name=count`, so a failing sweep says what went wrong where. */
const faults = (t: Tally): string[] => BAD.filter((k) => t[k] > 0).map((k) => `${k}=${t[k]}`);
const kept = (c: ContactOutcome) => !Number.isNaN(c.committedAt) && !c.uncommitted;
const seeds = (n: number): number[] => Array.from({ length: n }, (_, k) => k + 1);
const DRAW: Options = { penSeen: false };
const screenOf = (p: SimProfile): Vec2 => [p.screenMm[0], p.screenMm[1]];

/** Two words of pen writing from (60, 60) that end out of range. */
function penWords(w: SessionWriter, r: Rand, t0 = 500): PenPlan {
  const lead = w.profile.hover === 'none' ? 0 : w.profile.hoverLeadMs;
  const plan = planWriting(r, t0, { lines: 1, words: 2, lead, lineGap: [0, 0] });
  writePlan(w, plan);
  return plan;
}

const lastPoint = (plan: PenPlan): Vec2 => plan.pos(plan.strokes[plan.strokes.length - 1][1]);

/** A contact that lands at `at`, drifts `drift` mm over 60 to 250 ms as it settles, and rests until t1. */
function settle(w: SessionWriter, r: Rand, t0: number, t1: number, at: Vec2, drift: number, size: Vec2): number {
  const ms = between(r, 60, 250);
  const a = between(r, 0, 2 * Math.PI);
  return w.touch({
    t0,
    t1,
    at: (t) => {
      const f = Math.min(1, Math.max(0, (t - t0) / ms));
      return [at[0] + Math.cos(a) * drift * f, at[1] + Math.sin(a) * drift * f];
    },
    size: () => size,
    cls: 'palm',
    intent: 'none',
    stepMs: 14,
  });
}

/** A tip stroke that writes `len` mm to the right in `ms`. */
function tip(w: SessionWriter, t0: number, at: Vec2, o: { len?: number; ms?: number; size?: Vec2 } = {}): number {
  const len = o.len ?? 22;
  const ms = o.ms ?? 400;
  const size = o.size ?? (w.profile.stylus === 'touch' ? [4.5, 4] : [8, 7]);
  return w.touch({
    t0,
    t1: t0 + ms,
    at: (t) => {
      const f = Math.max(0, Math.min(1, (t - t0) / ms));
      return [at[0] + len * f, at[1] + 2 * Math.sin(f * 6)];
    },
    size: () => size,
    cls: w.profile.stylus === 'touch' ? 'pen' : 'finger',
    intent: 'ink',
    stepMs: 10,
  });
}

const TOUCH_IDS = [
  'win-touch',
  'win-stylus',
  'tablet-finger',
  'passive-stylus',
  'phone-finger',
  'ipad-finger',
  'ipad-stylus',
] as const;

describe('a hand that rests alone in finger drawing', () => {
  it('leaves no ink when it settles, rests 2 s, and lifts, whole or as a hand edge', () => {
    const fails: string[] = [];
    for (const id of TOUCH_IDS)
      for (const size of [[40, 30] as Vec2, [16, 10] as Vec2])
        for (const seed of seeds(6)) {
          const p = profileById(id);
          const [sw, sh] = screenOf(p);
          const t = run(
            p,
            seed,
            (w, r) => void settle(w, r, 200, 2200, [sw / 2, sh / 2], between(r, 2, 8), size),
            DRAW,
          );
          if (faults(t.tally).length > 0) fails.push(`${id} ${size[0]} mm seed ${seed}: ${faults(t.tally).join(' ')}`);
        }
    expect(fails).toEqual([]);
  });
});

describe('a resting hand that the digitizer reports as two contacts in finger drawing', () => {
  it('lets the tip write beside it and leaves no ink of its own', () => {
    const fails: string[] = [];
    for (const id of TOUCH_IDS)
      for (const seed of seeds(8)) {
        const p = profileById(id);
        const at: Vec2 = [Math.min(30, screenOf(p)[0] - 50), 50];
        const t = run(
          p,
          seed,
          (w, r) => {
            // The heel, and the pinky side 17 mm from it, which lands 115 ms later: a pair that never moves.
            settle(w, r, 100, 3000, [at[0] + 30, at[1] + 34], between(r, 0.3, 1.2), [16, 10]);
            settle(w, r, 215, 3000, [at[0] + 16, at[1] + 24], between(r, 0.3, 1), [10, 8]);
            for (const t0 of [989, 1685, 2324]) tip(w, t0, [at[0], at[1] + (t0 % 7)], { len: between(r, 15, 30) });
          },
          DRAW,
        );
        if (faults(t.tally).length > 0) fails.push(`${id} seed ${seed}: ${faults(t.tally).join(' ')}`);
      }
    expect(fails).toEqual([]);
  });
});

describe('a finger stroke that pauses while a stray contact lands', () => {
  it('keeps the whole stroke and draws nothing for the stray, wherever it lands', () => {
    const fails: string[] = [];
    for (const id of ['tablet-finger', 'phone-finger', 'ipad-finger', 'win-touch', 'passive-stylus'])
      for (const off of [
        [18, -8],
        [-20, -5],
        [0, -45],
        [-30, -40],
      ] as Vec2[])
        for (const seed of seeds(4)) {
          const p = profileById(id);
          const size: Vec2 = p.stylus === 'touch' ? [4.5, 4] : [8, 7];
          const t = run(
            p,
            seed,
            (w) => {
              w.touch({
                t0: 300,
                t1: 1300,
                at: (t) => [30 + 15 * Math.min(1, (t - 300) / 300) + 15 * Math.max(0, (t - 1000) / 300), 80],
                size: () => size,
                cls: p.stylus === 'touch' ? 'pen' : 'finger',
                intent: 'ink',
                stepMs: 10,
              });
              const at: Vec2 = [45 + off[0], 80 + off[1]];
              w.touch({
                t0: 780,
                t1: 930,
                at: (t) => [at[0] + (3 * (t - 780)) / 150, at[1]],
                size: () => [8, 7],
                cls: 'finger',
                intent: 'none',
              });
            },
            DRAW,
          );
          if (faults(t.tally).length > 0) fails.push(`${id} ${off} seed ${seed}: ${faults(t.tally).join(' ')}`);
        }
    expect(fails).toEqual([]);
  });
});

describe('a pen that lands while a touch scroll runs', () => {
  it('gets its first point after the scroll reverts, with the camera still for the whole stroke', () => {
    const fails: string[] = [];
    for (const id of ['usi-fire-max', 'pencil-1', 'surface-pen', 'wacom-aes'])
      for (const seed of seeds(8)) {
        const t = run(profileById(id), seed, (w, r) => {
          const plan = penWords(w, r);
          const last = lastPoint(plan);
          const t0 = plan.end + between(r, 1500, 4000);
          const at: Vec2 = [last[0] + 30, last[1] + 34];
          const slide = between(r, 12, 20);
          w.touch({
            t0,
            t1: t0 + 1800,
            at: (t) => [at[0] + slide * Math.min(1, Math.max(0, (t - t0) / 280)), at[1]],
            size: () => [10, 8],
            cls: 'palm',
            intent: 'none',
          });
          writePlan(w, planWriting(r, t0 + 420, { lines: 1, words: 1, lead: 0, lineGap: [0, 0], y0: 70 }));
        });
        if (t.result.penCameraMoved > 0) fails.push(`${id} seed ${seed}`);
      }
    expect(fails).toEqual([]);
  });
});

/**
 * Where a two-finger tap of the other hand lands, `gap` mm apart along x, clear of the writing hand. Without contact
 * sizes only position tells such a tap from a palm that settles twice, so there it also keeps clear of where the hand
 * starts the next line, on either side when the pen reports no lean: the known limit in the palm README.
 */
function tapSpot(r: Rand, p: SimProfile, plan: PenPlan, gap: number): Vec2 {
  const [sw, sh] = screenOf(p);
  const tipAt = lastPoint(plan);
  const hands: ['right' | 'left', Vec2][] = [['right', tipAt]];
  if (p.device.touchSize !== true) {
    hands.push(['right', [60, 70]]);
    if (p.tilt === 'none') hands.push(['left', tipAt], ['left', [60, 70]]);
  }
  const clear = (a: Vec2) => hands.every(([hand, at]) => !handCovers(hand, 'tripod', at, a));
  for (let k = 0; k < 2000; k++) {
    const a: Vec2 = [between(r, 15, sw - 15 - gap), between(r, 15, sh - 15)];
    if (clear(a) && clear([a[0] + gap, a[1]])) return a;
  }
  throw new Error(`no room for a tap on ${p.id}`);
}

function doubleTap(w: SessionWriter, t0: number, at: Vec2, gap: number, fingers = 2): void {
  for (let hop = 0; hop < 2; hop++)
    for (let k = 0; k < fingers; k++) {
      const t = t0 + hop * 250 + k * 15;
      const spot: Vec2 = [at[0] + k * gap, at[1]];
      w.touch({
        t0: t,
        t1: t0 + hop * 250 + 120,
        at: () => spot,
        size: () => [9, 8],
        cls: 'finger',
        intent: 'gesture',
      });
    }
}

describe('a two-finger double tap of the other hand on a pen device', () => {
  it('undoes at any time after the pen leaves, and a pen that writes again does not take it back', () => {
    const fails: string[] = [];
    for (const p of PEN_PROFILES)
      // A pen that reports as a mouse never leaves range: it stays near for 2 s after it stops.
      for (const after of p.id === 'wacom-emr-mouse' ? [2500, 25_000] : [1500, 5000, 12_000, 19_000, 25_000])
        for (const again of [false, true])
          for (const seed of seeds(1)) {
            const t = run(p, seed + after, (w, r) => {
              const plan = penWords(w, r);
              const t0 = plan.end + after;
              doubleTap(w, t0, tapSpot(r, p, plan, 22), 22);
              if (!again) return;
              const lead = p.hover === 'none' ? 0 : p.hoverLeadMs;
              const back = t0 + 370 + between(r, 400, 900);
              writePlan(w, planWriting(r, back, { lines: 1, words: 1, lead, lineGap: [0, 0], y0: 70 }));
            });
            const loud = t.result.gestures.filter((g) => !g.silent).length;
            const silent = t.result.gestures.length - loud;
            if (loud !== 1 || silent > 0)
              fails.push(`${p.id} ${after} ms ${again ? 'pen again' : ''}: ${loud}/${silent}`);
          }
    expect(fails).toEqual([]);
  });
});

describe('finger drawing on a pen device with "Draw with finger" on', () => {
  it('draws a finger stroke at any time after the pen, never scrolling the page', () => {
    const fails: string[] = [];
    for (const p of PEN_PROFILES)
      // From 2.5 s: a pen that reports as a mouse never leaves range, so it stays near for 2 s after it stops.
      for (const after of [2500, 10_000, 19_000])
        for (const spot of [
          [0, 25],
          [25, 45],
          [-50, -40],
        ] as Vec2[]) {
          const t = run(
            p,
            after + spot[0],
            (w, r) => {
              const plan = penWords(w, r);
              const last = lastPoint(plan);
              tip(w, plan.end + after, [last[0] + spot[0], last[1] + spot[1]], { len: 25 });
            },
            { settings: { fingerDraw: 'on' } },
          );
          if (faults(t.tally).length > 0) fails.push(`${p.id} ${after} ms ${spot}: ${faults(t.tally).join(' ')}`);
        }
    expect(fails).toEqual([]);
  });

  it('commits a dot 25 s after the pen within the commit delay limit', () => {
    for (const p of PEN_PROFILES.slice(0, 9)) {
      let id = -1;
      const t = run(
        p,
        3,
        (w, r) => {
          const plan = penWords(w, r);
          const at: Vec2 = [80, 100];
          tip(w, plan.end + 1000, at, { len: 25 });
          id = w.touch({
            t0: plan.end + 25_000,
            t1: plan.end + 25_090,
            at: () => at,
            size: () => [8, 7],
            cls: 'finger',
            intent: 'ink',
          });
        },
        { settings: { fingerDraw: 'on' } },
      );
      const c = t.out(id);
      expect(kept(c), p.id).toBe(true);
      expect(c.committedAt - c.end, p.id).toBeLessThanOrEqual(532);
    }
  });
});

const scenario = (name: string) => [...PEN_SCENARIOS, ...TOUCH_SCENARIOS].find((s) => s.name === name)!;

describe('a one-finger scroll of the other hand just after the pen lifts', () => {
  it('moves the page, from the moment the pen lifts', () => {
    const s = scenario('otherHandScrollRecent');
    const known = JSON.parse(readFileSync(LIMITS, 'utf8')) as { scenarios: { scenario: string; profiles: string[] }[] };
    const limit = known.scenarios.find((l) => l.scenario === s.name)?.profiles ?? [];
    let missed = 0;
    let meant = 0;
    for (const p of PEN_PROFILES.filter((x) => !limit.includes(x.id)))
      for (const hand of ['right', 'left'] as const)
        for (const seed of seeds(12)) {
          const session = generate(s, p, seed + 100, hand);
          const t = score(session, replaySession(session));
          missed += t.navMissed;
          meant += t.intendedNav;
        }
    expect(meant).toBeGreaterThan(250);
    expect(missed / meant).toBeLessThanOrEqual(0.01);
  });
});

describe('a left hand on a device whose system says right', () => {
  it('draws with a knuckle resting beside the tip, as with no system hint', () => {
    const s = scenario('knuckleNearStroke');
    const fails: string[] = [];
    for (const id of TOUCH_IDS)
      for (const seed of seeds(16)) {
        const p = profileById(id);
        const session = generate(s, p, seed, 'left');
        const replay = replaySession(session, { profile: { ...p.device, systemHandedness: 'right' } });
        const t = score(session, replay, emptyTally(), emptyTally());
        if (faults(t).length > 0) fails.push(`${id} seed ${seed}: ${faults(t).join(' ')}`);
      }
    expect(fails).toEqual([]);
  });

  it('causes no stray tap when the palm bounces where the next line starts', () => {
    const s = scenario('palmBounceNewLine');
    const fails: string[] = [];
    for (const id of ['oem-mpp-notilt', 'wacom-aes-notilt', 'oem-mpp', 'wacom-aes'])
      for (const seed of seeds(6)) {
        const p = profileById(id);
        const session = generate(s, p, seed, 'left');
        const replay = replaySession(session, { profile: { ...p.device, systemHandedness: 'right' } });
        const t = score(session, replay, emptyTally(), emptyTally());
        if (faults(t).length > 0) fails.push(`${id} seed ${seed}: ${faults(t).join(' ')}`);
      }
    expect(fails).toEqual([]);
  });
});

describe('a hand that rests with the pen long away and no pen following', () => {
  const NO_SIZE_PENS = ['oem-mpp', 'oem-mpp-notilt', 'wacom-aes', 'wacom-aes-notilt', 'surface-pen'];

  it('moves no camera when the palm lands as two parts', () => {
    const fails: string[] = [];
    for (const id of NO_SIZE_PENS)
      for (const seed of seeds(6)) {
        const t = run(profileById(id), seed, (w, r) => {
          const plan = penWords(w, r);
          const t0 = plan.end + 25_000;
          const offset = heelOffset(r, 'right', 'tripod');
          palm(w, r, { t0, t1: t0 + 2000, follow: () => [90, 80], offset, parts: 2, spread: 150, drift: [2, 8] });
        });
        if (faults(t.tally).length > 0) fails.push(`${id} seed ${seed}: ${faults(t.tally).join(' ')}`);
      }
    expect(fails).toEqual([]);
  });

  it('opens no menu and scrolls nothing when one contact settles still or slides as it lands', () => {
    const fails: string[] = [];
    for (const id of NO_SIZE_PENS)
      for (const drift of [
        [0, 1.2],
        [10, 14],
      ] as const)
        for (const seed of seeds(6)) {
          const t = run(profileById(id), seed, (w, r) => {
            const plan = penWords(w, r);
            const t0 = plan.end + 25_000;
            const offset = heelOffset(r, 'right', 'tripod');
            palm(w, r, { t0, t1: t0 + 2000, follow: () => [90, 80], offset, parts: 1, drift });
          });
          if (faults(t.tally).length > 0) fails.push(`${id} ${drift} seed ${seed}: ${faults(t.tally).join(' ')}`);
        }
    expect(fails).toEqual([]);
  });
});

describe('dots and short marks at a screen edge', () => {
  it('commits a dot and a comma 3 mm from the left, right, and bottom edges', () => {
    const fails: string[] = [];
    for (const id of ['phone-finger', 'tablet-finger', 'passive-stylus'])
      for (const len of [0, 1.5])
        for (const seed of seeds(3)) {
          const p = profileById(id);
          const [sw, sh] = screenOf(p);
          for (const at of [
            [3, sh / 2],
            [sw - 3, sh / 2],
            [sw / 2, sh - 3],
          ] as Vec2[]) {
            const t = run(
              p,
              seed,
              (w) => {
                w.touch({
                  t0: 300,
                  t1: 390,
                  at: (t) => [at[0], at[1] - (len * (t - 300)) / 90],
                  size: () => (p.stylus === 'touch' ? [4.5, 4] : [8, 7]),
                  cls: p.stylus === 'touch' ? 'pen' : 'finger',
                  intent: 'ink',
                  stepMs: 10,
                });
              },
              DRAW,
            );
            if (faults(t.tally).length > 0) fails.push(`${id} ${at} ${len} mm: ${faults(t.tally).join(' ')}`);
          }
        }
    expect(fails).toEqual([]);
  });
});

describe('time to first visible touch ink', () => {
  it('shows the first stroke of a session within 50 ms of its first 0.5 mm, on digitizers that report sizes', () => {
    const fails: string[] = [];
    for (const p of PROFILES.filter((x) => x.stylus !== 'pen' && x.size !== 'none' && x.size !== 'constant'))
      for (const seed of seeds(4)) {
        let id = -1;
        const t = run(p, seed, (w) => void (id = tip(w, 300, [20, 50])), DRAW);
        const c = t.out(id);
        // The tip moves 22 mm in 400 ms: 0.5 mm takes 9 ms, so the first shown sample comes within 50 ms of down.
        if (!(c.firstShown - c.start <= 60)) fails.push(`${p.id} seed ${seed}: ${c.firstShown - c.start} ms`);
      }
    expect(fails).toEqual([]);
  });
});

describe('device profiles against COMPAT', () => {
  it('reports system handedness on every Windows profile, in both values', () => {
    const windows = PROFILES.filter((p) => p.device.platform === 'windows');
    expect(windows.every((p) => p.device.systemHandedness === 'right' || p.device.systemHandedness === 'left')).toBe(
      true,
    );
    expect(new Set(windows.map((p) => p.device.systemHandedness)).size).toBe(2);
  });

  it('says Fire OS and a passive stylus on Android have no OS palm cancel, and keeps a stroke a system gesture cuts', () => {
    for (const id of ['usi-fire-max', 'passive-stylus']) expect(profileById(id).device.osPalmCancel).toBe(false);
    const s = scenario('systemGestureCancel');
    for (const seed of seeds(8)) {
      const session = generate(s, profileById('passive-stylus'), seed);
      expect(faults(score(session, replaySession(session))), `seed ${seed}`).toEqual([]);
    }
  });

  it('falls back to 6.3 px per mm on Android when the device reports none', () => {
    expect(resolvePxPerMm(undefined, undefined, 'android')).toBeCloseTo(6.3);
    expect(resolvePxPerMm(undefined, undefined, 'unknown')).toBeCloseTo(5.2);
  });

  it('has an iPhone profile with single-radius sizes on a phone screen', () => {
    const p = profileById('iphone-finger');
    expect(p.size).toBe('quantized');
    expect(p.screenMm[0]).toBeLessThan(80);
  });

  it('blocks S Pen touches while the pen hovers, not only while it is down', () => {
    const p = profileById('s-pen');
    const w = new SessionWriter(p, seeded(1), { handedness: 'right', grip: 'tripod', settings: {}, task: 't' });
    w.hover(100, 600, () => [60, 60]);
    expect(w.touch({ t0: 300, t1: 400, at: () => [90, 90], size: () => [9, 8], cls: 'finger', intent: 'tap' })).toBe(
      -1,
    );
  });

  it('keeps an 18 mm thumb stroke on an iPad, which reports it as a 20 mm radius', () => {
    for (const id of ['ipad-finger', 'ipad-stylus'])
      for (const seed of seeds(4)) {
        let id2 = -1;
        const t = run(profileById(id), seed, (w) => void (id2 = tip(w, 300, [40, 60], { size: [18, 12] })), DRAW);
        expect(kept(t.out(id2)), `${id} seed ${seed}`).toBe(true);
      }
  });
});
