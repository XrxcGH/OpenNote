// Finger and passive stylus scenarios: drawing with a resting hand, pinches, taps, edges, and hands that rest alone.

import { awayFrom, driftAt, palmLimit, palmShape, RANGES, sizeAt } from './hands';
import { doubleTap, screen, side, tipStroke, touch, words } from './scenarioKit';
import type { Scenario } from './scenarioKit';
import { between } from './writer';
import type { Rand, SessionWriter, Vec2 } from './writer';

/** A palm resting while a tip writes: it lands 8 to 30 mm and grows, drifting as it settles. */
function restingHand(w: SessionWriter, r: Rand, t0: number, t1: number, at: Vec2, small = false): void {
  const sx = side(w) === 'left' ? -1 : 1;
  const tip: Vec2 = [Math.min(at[0], screen(w)[0] - 50), at[1]];
  const offset: Vec2 = [sx * between(r, 25, 35), between(r, 28, 40)];
  const shape = palmShape(r, small);
  const dir = awayFrom(r, offset);
  w.touch({
    t0,
    t1,
    at: (t) => {
      const [dx, dy] = driftAt(shape, t0, t, dir);
      return [tip[0] + offset[0] + dx, tip[1] + offset[1] + dy];
    },
    size: (t) => sizeAt(shape, t0, t),
    cls: 'palm',
    intent: 'none',
    limit: palmLimit(w.profile, shape, 1, t1 - t0),
    stepMs: 16,
  });
}

function fingerTaps(w: SessionWriter, r: Rand, t0: number, fingers: number): void {
  const gap = between(r, ...RANGES.tapSpacingMm);
  const x0 = Math.max(12, Math.min(40, screen(w)[0] - 12 - (fingers - 1) * gap));
  doubleTap(w, r, t0, [x0, 80], gap, fingers);
}

/**
 * A hand that rests alone in finger drawing and lifts: one contact, or two (heel and pinky side) that the digitizer
 * splits it into, drifting `drift` mm as each settles. With `tip`, a tip writes words beside it.
 */
function lone(
  w: SessionWriter,
  r: Rand,
  drift: readonly [number, number],
  ms: readonly [number, number],
  tip: boolean,
) {
  const [sw, sh] = screen(w);
  const sx = side(w) === 'left' ? -1 : 1;
  // The tip writes rightward from where it lands; the heel sits below it, on the hand's side, on the screen.
  const writeAt: Vec2 = [sx > 0 ? Math.min(30, sw - 55) : Math.max(sw - 45, 15), Math.min(50, sh - 60)];
  const hx = writeAt[0] + sx * between(r, 25, 35);
  const heel: Vec2 = [Math.max(12, Math.min(sw - 12, hx)), writeAt[1] + between(r, 28, 40)];
  const t1 = 100 + between(r, ...ms);
  const shape = palmShape(r, false, drift);
  const parts = 1 + Math.round(r());
  for (let k = 0; k < parts; k++) {
    const t0 = 100 + (k === 0 ? 0 : between(r, 40, 200));
    const at: Vec2 = k === 0 ? heel : [heel[0] - sx * 14, heel[1] - 10];
    const dir = awayFrom(r, [sx, 1]);
    w.touch({
      t0,
      t1,
      at: (t) => {
        const [dx, dy] = driftAt(shape, t0, t, dir);
        return [at[0] + dx, at[1] + dy];
      },
      size: (t) => sizeAt(shape, t0, t, k === 0 ? 1 : 0.6),
      cls: 'palm',
      intent: 'none',
      limit: palmLimit(w.profile, shape, k === 0 ? 1 : 0.6, t1 - t0),
      stepMs: 14,
    });
  }
  if (tip)
    for (let t = 100 + between(r, 300, 900); t < t1 - 450; t += between(r, 600, 900)) tipStroke(w, r, t, writeAt);
}

/** A finger stroke that pauses mid-way while a stray contact of the other fingers lands and slides a little. */
function pausedStroke(w: SessionWriter, r: Rand): void {
  const stylus = w.profile.stylus === 'touch';
  const size: Vec2 = stylus ? [4.5, 4] : [8, 7];
  const [sw, sh] = screen(w);
  const from: Vec2 = [Math.min(30, sw - 45), Math.min(80, sh - 60)];
  const pause = between(r, 150, 800);
  const first = between(r, 250, 400);
  const a = first;
  const b = first + pause;
  const end = b + between(r, 250, 400);
  const len = Math.min(30, sw - from[0] - 10);
  w.touch({
    t0: 300,
    t1: 300 + end,
    at: (t) => {
      const age = t - 300;
      const f = age < a ? age / a / 2 : age < b ? 0.5 : 0.5 + (age - b) / (end - b) / 2;
      return [from[0] + len * f, from[1]];
    },
    size: () => size,
    cls: stylus ? 'pen' : 'finger',
    intent: 'ink',
    stepMs: 10,
  });
  const mid: Vec2 = [from[0] + len / 2, from[1]];
  const offsets: Vec2[] = [
    [18, -8],
    [-20, -5],
    [0, -45],
    [-30, -40],
  ];
  const off = offsets[Math.floor(r() * offsets.length)];
  const at: Vec2 = [Math.max(8, Math.min(sw - 8, mid[0] + off[0])), Math.max(8, mid[1] + off[1])];
  const t0 = 300 + a + between(r, 50, Math.max(60, pause - 100));
  w.touch({
    t0,
    t1: t0 + between(r, 80, 200),
    at: (t) => [at[0] + (3 * (t - t0)) / 150, at[1]],
    size: () => [8, 7],
    cls: 'finger',
    intent: 'none',
  });
}

/**
 * A finger pinch in finger drawing: the index lands, then the thumb `late` ms later, and both spread; the index goes
 * up and the thumb along `dir`.
 */
function pinch(
  w: SessionWriter,
  r: Rand,
  t0: number,
  late: number,
  index: Vec2,
  thumb: Vec2,
  size: Vec2,
  dir: Vec2 = [-0.3, 1],
): void {
  const spread = between(r, 12, 20);
  const grow = (t: number) => Math.max(0, t - t0 - late - 40) * (spread / 400);
  w.touch({
    t0,
    t1: t0 + late + 500,
    at: (t) => [index[0], index[1] - grow(t)],
    size: () => [9, 8],
    cls: 'finger',
    intent: 'zoom',
  });
  w.touch({
    t0: t0 + late,
    t1: t0 + late + 500,
    at: (t) => [thumb[0] + grow(t) * dir[0], thumb[1] + grow(t) * dir[1]],
    size: () => size,
    cls: 'thumb',
    intent: 'zoom',
  });
}

export const TOUCH_SCENARIOS: readonly Scenario[] = [
  touch('fingerDraw', (w, r) => void words(w, r, 300, 5)),
  touch('fingerDrawKnuckles', (w, r) => {
    restingHand(w, r, 100, 3500, [60, 60]);
    words(w, r, 100 + between(r, 0, 600), 4);
  }),
  touch('passiveStylusPalmFirst', (w, r) => {
    restingHand(w, r, 100, 3000, [45, 60]);
    words(w, r, 100 + between(r, 0, 600), 3);
  }),
  touch('passiveStylusSmallPalmFirst', (w, r) => {
    restingHand(w, r, 100, 3000, [45, 60], true);
    words(w, r, 100 + between(r, 0, 600), 3);
  }),
  touch('knuckleNearStroke', (w, r) => {
    // A knuckle of the writing hand lands within 120 ms of the tip, resting or sliding along with it.
    const sx = side(w) === 'left' ? -1 : 1;
    const t0 = 300;
    const at: Vec2 = [40, 50];
    const len = 22;
    const drag = r() < 0.5;
    const off: Vec2 = [sx * between(r, 22, 32), between(r, 26, 36)];
    const lag = between(r, -80, 120);
    const size: Vec2 = [between(r, 8, 10), 7];
    tipStroke(w, r, t0, at);
    w.touch({
      t0: t0 + lag,
      t1: t0 + 460,
      at: (t) => {
        const f = drag ? Math.max(0, Math.min(1, (t - t0) / 400)) : 0;
        return [at[0] + off[0] + len * f, at[1] + off[1]];
      },
      size: () => size,
      cls: 'knuckle',
      intent: 'none',
    });
  }),
  touch('fingerDrawLatePinch', (w, r) => {
    const late = between(r, 20, 250);
    const thumb: Vec2 = [60 - between(r, 10, 20), 80 + between(r, 30, 45)];
    pinch(w, r, 300, late, [60, 80], thumb, [between(r, 12, 18), between(r, 10, 12)]);
  }),
  touch('edgeStrokes', (w, r) => {
    // An index that rests at the left edge before it writes, and a thumb that writes from the right edge at once.
    const [sw] = screen(w);
    const restAt: Vec2 = [between(r, 1.5, 4.5), 50];
    w.touch({
      t0: 300,
      t1: 300 + 200 + 400,
      at: (t) => [restAt[0] + 25 * Math.max(0, Math.min(1, (t - 500) / 400)), restAt[1]],
      size: () => [8, 7],
      cls: 'finger',
      intent: 'ink',
      stepMs: 10,
    });
    // Dots and commas 1.5 to 4.5 mm from the left and the right edge.
    const marks: Vec2[] = [
      [between(r, 1.5, 4.5), 120],
      [sw - between(r, 1.5, 4.5), 30],
    ];
    marks.forEach((at, k) => {
      const t0 = 2000 + k * 400;
      const len = r() < 0.5 ? 0 : 1.5;
      w.touch({
        t0,
        t1: t0 + between(r, 60, 120),
        at: (t) => [at[0], at[1] - len * Math.min(1, (t - t0) / 90)],
        size: () => [8, 7],
        cls: 'finger',
        intent: 'ink',
        stepMs: 10,
      });
    });
    const thumbAt: Vec2 = [sw - between(r, 1.5, 4.5), 90];
    const thumbSize: Vec2 = [between(r, 12, 15), 11];
    w.touch({
      t0: 1400,
      t1: 1800,
      at: (t) => [thumbAt[0] - 25 * ((t - 1400) / 400), thumbAt[1] + 2 * Math.sin((t - 1400) / 60)],
      size: () => thumbSize,
      cls: 'thumb',
      intent: 'ink',
      stepMs: 10,
    });
  }),
  touch('edgePinch', (w, r) => {
    const [, sh] = screen(w);
    const index: Vec2 = [40, sh - 50];
    const thumb: Vec2 = [30, sh - between(r, 2, 4.5)];
    pinch(w, r, 300, between(r, 20, 200), index, thumb, [between(r, 13, 17), 11], [-1, 0]);
  }),
  touch('phoneFingerOnly', (w, r) => void words(w, r, 300, 4)),
  touch('threeFingerTapInDrawMode', (w, r) => fingerTaps(w, r, 300, 3)),
  touch('twoFingerDoubleTap', (w, r) => fingerTaps(w, r, 300, 2)),
  // A hand that rests alone and lifts, drifting less than a settling palm travels: never ink.
  touch('loneRest', (w, r) => lone(w, r, [0, 9.5], [600, 3000], false)),
  // The same hand bouncing, down for 150 to 300 ms: a dot by every signal on a digitizer without sizes.
  touch('loneBounce', (w, r) => lone(w, r, [0, 8], [150, 300], false)),
  // A hand that slides 10 to 20 mm as it lands, alone: a stroke by every signal unless its size tells.
  touch('loneSlide', (w, r) => lone(w, r, [10, 20], [600, 3000], false)),
  // A resting hand, often split in two contacts, while a tip writes beside it.
  touch('restingHandParts', (w, r) => lone(w, r, [0, 9.5], [2500, 3500], true)),
  touch('pausedStroke', (w, r) => pausedStroke(w, r)),
  touch('blurMidStroke', (w, r) => {
    const end = words(w, r, 300, 2);
    tipStroke(w, r, end, [30, 90], 600, end + 301);
    w.system('blur', end + 300);
    w.system('focus', end + 2000);
  }),
  touch(
    'systemGestureCancel',
    (w, r) => {
      // A system gesture cancels a stroke mid-way. Where the platform never cancels palms, the stroke so far stays.
      const end = words(w, r, 300, 2);
      tipStroke(w, r, end, [30, 90], 600, end + between(r, 150, 450));
    },
    { when: (p) => p.device.osPalmCancel === false },
  ),
  touch('pageSwitchMidStroke', (w, r) => {
    const end = words(w, r, 300, 2);
    tipStroke(w, r, end, [30, 90], 600, end + 301);
    w.system('pageswitch', end + 300);
  }),
  touch('gripThumbEdge', (w, r) => {
    const at: Vec2 = [between(r, 1, 3), between(r, 60, 120)];
    w.touch({
      t0: 100,
      t1: 3500,
      at: () => at,
      size: () => [16, 10],
      cls: 'grip-thumb',
      intent: 'none',
    });
    words(w, r, 400, 4);
  }),
];
