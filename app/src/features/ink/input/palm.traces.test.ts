// Traces from the fourth palm rejection review, each replayed through the shipped pipeline on the device profiles
// the review used. Positions are millimeters on the glass. Each test names the defect it guards.

import { describe, expect, it } from 'vitest';
import { EMPTY_LEARNED } from './palm/index';
import type { PalmSettings } from './palm/index';
import { planWriting, writePlan } from './testing/hands';
import { emptyTally, score } from './testing/metrics';
import { profileById } from './testing/profiles';
import type { SimProfile } from './testing/profiles';
import { replaySession } from './testing/replay';
import type { ContactOutcome, ReplayResult } from './testing/replay';
import { generate, PEN_SCENARIOS } from './testing/scenarios';
import type { Session } from './testing/session';
import { seeded, SessionWriter } from './testing/writer';
import type { Rand, Vec2 } from './testing/writer';

interface Options {
  readonly settings?: Partial<PalmSettings>;
  readonly penSeen?: boolean;
  readonly hand?: 'right' | 'left';
}

interface Run {
  readonly session: Session;
  readonly result: ReplayResult;
  readonly out: (id: number) => ContactOutcome;
}

function run(p: SimProfile, seed: number, build: (w: SessionWriter, r: Rand) => void, o: Options = {}): Run {
  const r = seeded(seed * 7919 + 17);
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
  const result = replaySession(session, { profile: p.device });
  return { session, result, out: (id) => result.contacts.get(id)! };
}

const kept = (c: ContactOutcome) => !Number.isNaN(c.committedAt) && !c.uncommitted;
const moved = (run: Run, id: number) => run.out(id).peak / run.result.cssPxPerMm > 1.5;
const sized = (p: SimProfile, size: SimProfile['size']): SimProfile => ({ ...p, size });

/** A touch stroke from `at` that writes `len` mm to the right over `ms`, with a small wobble. */
function stroke(
  w: SessionWriter,
  t0: number,
  at: Vec2,
  size: Vec2,
  o: { len?: number; ms?: number; rest?: number } = {},
) {
  const len = o.len ?? 22;
  const ms = o.ms ?? 400;
  const rest = o.rest ?? 0;
  return w.touch({
    t0,
    t1: t0 + rest + ms,
    at: (t) => {
      const f = Math.max(0, Math.min(1, (t - t0 - rest) / ms));
      return [at[0] + len * f, at[1] + 2 * Math.sin(f * 6)];
    },
    size: () => size,
    cls: w.profile.stylus === 'touch' ? 'pen' : 'finger',
    intent: 'ink',
    stepMs: 10,
  });
}

const DRAW: Options = { penSeen: false };

/** Every pair of values, so a sweep is one loop. */
const grid = <A, B>(as: readonly A[], bs: readonly B[]): [A, B][] => as.flatMap((a) => bs.map((b): [A, B] => [a, b]));
const seeds = (n: number): number[] => Array.from({ length: n }, (_, k) => k + 1);

/** A palm edge lands small at 100 ms and grows into a palm at 410 ms; a stylus tip lands `delay` ms after it. */
function smallPalmThenTip(delay: number, seed: number): void {
  let tip = -1;
  let heel = -1;
  const t = run(
    profileById('passive-stylus'),
    seed,
    (w) => {
      heel = w.touch({
        t0: 100,
        t1: 1200,
        at: () => [90, 94],
        size: (at) => (at < 410 ? [10, 8] : [40, 25]),
        cls: 'palm',
        intent: 'none',
        stepMs: 16,
      });
      tip = stroke(w, 100 + delay, [60, 60], [5, 4.5], { ms: 500 - delay });
    },
    DRAW,
  );
  expect(kept(t.out(tip)), `delay ${delay}, seed ${seed}`).toBe(true);
  expect(kept(t.out(heel))).toBe(false);
}

/** A fingertip stroke at 300 ms. A knuckle of the same hand lands `lag` ms later and rests or drags along. */
function knuckleBesideTip(id: string, lag: number, drag: boolean): void {
  const p = profileById(id);
  const tipSize: Vec2 = p.stylus === 'touch' ? [5, 4.5] : [8, 7];
  let tip = -1;
  let knuckle = -1;
  const along = (at: number) => (drag ? 22 * Math.max(0, Math.min(1, (at - 300) / 400)) : 0);
  const t = run(
    p,
    lag + 200,
    (w, r) => {
      const off: Vec2 = [22 + 10 * r(), 26 + 10 * r()];
      tip = stroke(w, 300, [20, 40], tipSize);
      knuckle = w.touch({
        t0: 300 + lag,
        t1: 760,
        at: (at) => [20 + off[0] + along(at), 40 + off[1]],
        size: () => [9, 7],
        cls: 'knuckle',
        intent: 'none',
        stepMs: 12,
      });
    },
    DRAW,
  );
  const name = `${id}, knuckle ${lag} ms, ${drag ? 'dragging' : 'resting'}`;
  expect(kept(t.out(tip)), name).toBe(true);
  expect(kept(t.out(knuckle)), name).toBe(false);
  expect(moved(t, tip) || moved(t, knuckle), name).toBe(false);
}

/** A 45 mm palm that drifts 4 mm as it lands and rests, on a screen without sizes, while four tip strokes write. */
function driftingPalmNoSize(id: string, size: SimProfile['size'], seed: number): void {
  const tips: number[] = [];
  let heel = -1;
  const t = run(
    sized(profileById(id), size),
    seed,
    (w) => {
      heel = w.touch({
        t0: 100,
        t1: 3400,
        at: (at) => [95 + 4 * Math.min(1, (at - 100) / 200), 95],
        size: () => [45, 28],
        cls: 'palm',
        intent: 'none',
        stepMs: 16,
      });
      for (const [k, t0] of [700, 1400, 2100, 2800].entries()) tips.push(stroke(w, t0, [45 + 8 * k, 60], [8, 7]));
    },
    DRAW,
  );
  for (const tip of tips) expect(kept(t.out(tip)), `${id} ${size} seed ${seed}`).toBe(true);
  // The palm drifts like a short stroke until a tip lands beside it; its ink goes then, never later.
  const h = t.out(heel);
  expect(kept(h)).toBe(false);
  if (h.shown > 0) expect(h.retractedAt).toBeLessThanOrEqual(700);
}

describe('finger and stylus drawing keeps the stroke when a second contact lands near it', () => {
  it('keeps a stylus stroke that lands 40 to 290 ms after a small palm, which later grows', () => {
    for (const [delay, seed] of grid([0, 40, 100, 180, 250, 290], seeds(5))) smallPalmThenTip(delay, seed);
  });

  it('keeps a fingertip stroke when a knuckle of the same hand lands within 120 ms, resting or dragging', () => {
    const lags = grid([-80, -30, 0, 40, 80, 120], [false, true]);
    for (const id of ['tablet-finger', 'phone-finger', 'passive-stylus']) {
      for (const [lag, drag] of lags) knuckleBesideTip(id, lag, drag);
    }
  });

  it('keeps finger strokes on touch screens that report no contact size while a drifting palm rests', () => {
    const sizes = grid(['none', 'constant'] as const, seeds(4));
    for (const id of ['tablet-finger', 'passive-stylus']) {
      for (const [size, seed] of sizes) driftingPalmNoSize(id, size, seed);
    }
  });
});

describe('finger drawing pinch with a real thumb', () => {
  it('zooms and leaves no ink with a 13 to 16 mm thumb, at every landing delay, and with quantized sizes', () => {
    const cases: [string, SimProfile['size'], Vec2][] = [
      ['tablet-finger', 'real', [13, 11]],
      ['tablet-finger', 'real', [16, 12]],
      ['phone-finger', 'real', [13, 11]],
      ['tablet-finger', 'quantized', [10, 9]],
    ];
    for (const [id, size, thumbSize] of cases) {
      const p = sized(profileById(id), size);
      for (const late of [20, 80, 140, 250]) {
        const ids: number[] = [];
        const t = run(
          p,
          late,
          (w, r) => {
            const spread = 12 + 8 * r();
            const grow = (at: number) => Math.max(0, at - 300 - late - 40) * (spread / 400);
            const thumb: Vec2 = [60 - 10 - 10 * r(), 80 + 30 + 15 * r()];
            ids.push(
              w.touch({
                t0: 300,
                t1: 300 + late + 500,
                at: (at) => [60, 80 - grow(at)],
                size: () => [9, 8],
                cls: 'finger',
                intent: 'zoom',
              }),
              w.touch({
                t0: 300 + late,
                t1: 300 + late + 500,
                at: (at) => [thumb[0], thumb[1] + grow(at)],
                size: () => thumbSize,
                cls: 'thumb',
                intent: 'zoom',
              }),
            );
          },
          DRAW,
        );
        for (const c of ids) {
          expect(Number.isNaN(t.out(c).startedAt), `${id} ${size} thumb ${thumbSize[0]} at ${late} ms`).toBe(false);
          expect(kept(t.out(c))).toBe(false);
        }
      }
    }
  });
});

describe('strokes that start at a screen edge', () => {
  it('keeps an index stroke that rests at the edge first, and a thumb stroke that starts there', () => {
    for (const id of ['phone-finger', 'tablet-finger']) {
      const p = profileById(id);
      for (let seed = 1; seed <= 3; seed++) {
        let index = -1;
        let thumb = -1;
        const t = run(
          p,
          seed,
          (w) => {
            index = stroke(w, 300, [3, 60], [8, 7], { rest: 200, len: 25 });
            thumb = stroke(w, 1500, [4, 100], [13, 11], { len: 25 });
          },
          DRAW,
        );
        expect(kept(t.out(index)), `${id} index`).toBe(true);
        expect(kept(t.out(thumb)), `${id} thumb`).toBe(true);
      }
    }
  });

  it('zooms with the other hand when its thumb lands near the bottom edge, with the pen recent', () => {
    const p = profileById('usi-fire-max');
    for (let seed = 1; seed <= 4; seed++) {
      const ids: number[] = [];
      const t = run(p, seed, (w, r) => {
        const plan = planWriting(r, 500, { lines: 1, words: 2, lead: 0, lineGap: [0, 0] });
        writePlan(w, plan);
        const t0 = plan.end + 1200;
        const spread = 10 + 6 * r();
        const grow = (at: number) => Math.max(0, at - t0 - 60) * (spread / 400);
        ids.push(
          w.touch({
            t0,
            t1: t0 + 500,
            at: (at) => [20, 120 - grow(at)],
            size: () => [9, 8],
            cls: 'finger',
            intent: 'zoom',
          }),
          w.touch({
            t0: t0 + 30,
            t1: t0 + 500,
            at: (at) => [22 + grow(at), 151],
            size: () => [15, 12],
            cls: 'thumb',
            intent: 'zoom',
          }),
        );
      });
      for (const c of ids) expect(Number.isNaN(t.out(c).startedAt), `seed ${seed}`).toBe(false);
    }
  });
});

/** Writes one line of three words, then returns the plan. */
function line(w: SessionWriter, r: Rand, t0: number, y = 60) {
  const lead = w.profile.hover === 'none' ? 0 : w.profile.hoverLeadMs;
  const plan = planWriting(r, t0, { lines: 1, words: 3, lead, lineGap: [0, 0], y0: y });
  writePlan(w, plan);
  return plan;
}

/** A palm that settles twice as two contacts 25 s after a line, then the pen writes `penAfter` ms later. */
function doubleSettleAway(id: string, penAfter: number, seed: number): void {
  const t = run(profileById(id), seed, (w, r) => {
    const plan = line(w, r, 500);
    const at: Vec2 = [60 + 40, 70 + 45];
    const b: Vec2 = [at[0] - 14, at[1] - 10];
    let t0 = plan.end + 25_000;
    for (let hop = 0; hop < 2; hop++) {
      w.touch({ t0, t1: t0 + 120, at: () => at, size: () => [40, 30], cls: 'palm', intent: 'none' });
      w.touch({ t0: t0 + 14, t1: t0 + 120, at: () => b, size: () => [40, 30], cls: 'palm', intent: 'none' });
      t0 += 200;
    }
    line(w, r, t0 - 200 + 120 + penAfter, 70);
  });
  const undo = t.result.gestures.filter((g) => g.kind === 'undo').length;
  const redo = t.result.gestures.filter((g) => g.kind === 'redo').length;
  expect(undo - redo, `${id}, pen ${penAfter} ms later, seed ${seed}`).toBe(0);
}

/** A palm that lands small, grows, and slides 5 mm, `pause` ms after a line, with the pen `penAfter` ms later. */
function slidingPalm(id: string, pause: number, penAfter: number, seed: number): void {
  let heel = -1;
  const t = run(profileById(id), seed, (w, r) => {
    const plan = line(w, r, 500);
    const t0 = plan.end + pause;
    const at: Vec2 = [140 - 80 + 42, 75 + 48];
    heel = w.touch({
      t0,
      t1: t0 + penAfter + 1500,
      at: (tt) => [at[0] - 5 * Math.min(1, (tt - t0) / 180), at[1]],
      size: (tt) => (tt - t0 < 60 ? [12, 10] : [45, 30]),
      cls: 'palm',
      intent: 'none',
      stepMs: 14,
    });
    writePlan(w, planWriting(r, t0 + penAfter, { lines: 1, words: 2, lead: 0, lineGap: [0, 0], x0: 60, y0: 75 }));
  });
  const c = t.out(heel);
  const mm = 1 / t.result.cssPxPerMm;
  expect(Math.hypot(c.camX, c.camY) * mm, `${id} residual, seed ${seed}`).toBeLessThanOrEqual(1.5);
  expect(c.peak * mm, `${id} peak, seed ${seed}`).toBeLessThanOrEqual(1.5);
}

/** A palm that touches down for 120 ms where the next line starts, 0.9 to 3 s after the pen left. */
function bounceAtNewLine(id: string, size: Vec2, seed: number): void {
  let bounce = -1;
  const t = run(profileById(id), seed, (w, r) => {
    const plan = line(w, r, 500);
    const last = plan.pos(plan.end - 200);
    const t0 = plan.end + 900 + 2100 * r();
    const at: Vec2 = [last[0] - 85 + 42, last[1] + 10 + 48];
    bounce = w.touch({ t0, t1: t0 + 120, at: () => at, size: () => size, cls: 'palm', intent: 'none' });
    line(w, r, t0 + 300, last[1] + 10);
  });
  expect(t.out(bounce).tapAllowed, `${id} seed ${seed}`).toBe(false);
}

describe('a palm that lands after a long pause', () => {
  it('never undoes when a palm settles twice as two contacts 25 s after the pen', () => {
    const runs = grid([250, 700], seeds(4));
    for (const id of ['oem-mpp', 'wacom-aes'])
      for (const [penAfter, seed] of runs) doubleSettleAway(id, penAfter, seed);
  });

  it('never leaves the page scrolled by a palm that slides as it lands, with sizes or without', () => {
    const cases: [string, number, number][] = [
      ['usi-fire-max', 25_000, 700],
      ['usi-fire-max', 25_000, 1200],
      ['pencil-1', 25_000, 700],
      ['oem-mpp', 3000, 500],
      ['wacom-aes', 3000, 900],
    ];
    for (const [[id, pause, penAfter], seed] of grid(cases, seeds(4))) slidingPalm(id, pause, penAfter, seed);
  });

  it('never taps the page with a palm that bounces where the next line starts', () => {
    const cases: [string, Vec2][] = [
      ['oem-mpp', [40, 30]],
      ['wacom-aes', [40, 30]],
      ['surface-pen', [10, 8]],
      ['usi-fire-max', [10, 8]],
      ['wacom-emr', [10, 8]],
      ['pencil-1', [10, 8]],
    ];
    for (const [[id, size], seed] of grid(cases, seeds(6))) bounceAtNewLine(id, size, seed);
  });
});

describe('a left hand on a pen with neither tilt nor contact size', () => {
  it('causes no stray action in any pen scenario', () => {
    for (const id of ['oem-mpp', 'wacom-aes']) {
      const p: SimProfile = { ...profileById(id), tilt: 'none' };
      const tally = emptyTally();
      for (const s of PEN_SCENARIOS) {
        for (let seed = 1; seed <= 2; seed++) {
          const session = generate({ ...s, hand: 'left' }, p, seed);
          score(session, replaySession(session, { profile: p.device }), tally);
        }
      }
      expect([tally.strayInk, tally.strayCamera, tally.strayTaps, tally.strayGestures], id).toEqual([0, 0, 0, 0]);
      expect([tally.navMissed, tally.tapMissed, tally.inkDropped], id).toEqual([0, 0, 0]);
    }
  });
});

describe('finger dots', () => {
  it('shows and commits a dot as soon as a stroke, on a pen device with finger drawing on', () => {
    let dot = -1;
    const t = run(
      profileById('surface-pen'),
      1,
      (w) => {
        dot = w.touch({ t0: 30_000, t1: 30_080, at: () => [60, 60], size: () => [8, 7], cls: 'finger', intent: 'ink' });
        stroke(w, 30_400, [70, 60], [8, 7], { ms: 300 });
      },
      { settings: { fingerDraw: 'on' } },
    );
    const c = t.out(dot);
    expect(c.committedAt - c.end).toBeLessThanOrEqual(532);
    expect(c.firstShown - c.end).toBeLessThanOrEqual(0);
  });

  it('commits a dot at once on an iPad that has never seen a pen', () => {
    const p: SimProfile = { ...profileById('passive-stylus'), device: profileById('pencil-1').device };
    let dot = -1;
    const t = run(
      p,
      1,
      (w) => {
        dot = w.touch({ t0: 30_000, t1: 30_080, at: () => [60, 60], size: () => [5, 5], cls: 'pen', intent: 'ink' });
      },
      DRAW,
    );
    expect(t.out(dot).committedAt - t.out(dot).end).toBe(0);
  });

  it('keeps a finger stroke that reports one radius of 16 mm', () => {
    let tip = -1;
    const t = run(profileById('tablet-finger'), 1, (w) => void (tip = stroke(w, 300, [40, 60], [16, 16])), DRAW);
    expect(kept(t.out(tip))).toBe(true);
  });
});

describe('a pen that reports as a mouse', () => {
  it('never commits the writing hand as finger ink', () => {
    const base = profileById('wacom-emr');
    const p: SimProfile = { ...base, device: { ...base.device, id: 'windows-pen-as-mouse' } };
    for (const size of ['none', 'real'] as const) {
      for (let seed = 1; seed <= 4; seed++) {
        let heel = -1;
        const t = run(
          sized(p, size),
          seed,
          (w, r) => {
            const plan = line(w, r, 300);
            const follow = (tt: number) => plan.pos(Math.max(plan.start, tt));
            heel = w.touch({
              t0: 300,
              t1: plan.end,
              at: (tt) => [follow(tt)[0] + 30, follow(tt)[1] + 35],
              size: () => [10, 8],
              cls: 'palm',
              intent: 'none',
              stepMs: 14,
            });
          },
          DRAW,
        );
        expect(kept(t.out(heel)), `${size} seed ${seed}`).toBe(false);
      }
    }
  });
});
