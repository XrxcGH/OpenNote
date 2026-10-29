// Adversarial scenarios (palm README, "Measurement"). Each builds a labeled session on a simulated device from a
// seed. Pen scenarios run on every pen profile, touch scenarios on every finger and passive stylus profile, each with
// both hands, and the seeds turn through the four grips. Every contact is labeled with what it was and what the
// person meant, which is the oracle the metrics check. Timing, sizes, and places are drawn from ranges that straddle
// the classifier's thresholds (`RANGES`), so the corpus measures the rules rather than inputs shaped to them. What no
// signal a page can see tells apart is listed in tests/fixtures/palm/known-limits.json and reported, not gated.

import { EMPTY_LEARNED } from '../palm/index';
import { handCovers, handFollow, heelOffset, otherHand, palm, planWriting, RANGES, writePlan } from './hands';
import type { PenPlan } from './hands';
import type { SimProfile } from './profiles';
import { doubleTap, dot, lead, pen, screen, side, tipStroke, unknownSide, words } from './scenarioKit';
import type { Scenario } from './scenarioKit';
import type { Grip, Session } from './session';
import { TOUCH_SCENARIOS } from './touchScenarios';
import { between, SessionWriter, seeded } from './writer';
import type { Rand, Vec2 } from './writer';

export type { Scenario } from './scenarioKit';
export { TOUCH_SCENARIOS } from './touchScenarios';

/** Writes `lines` lines with a palm planted per line; `palmAt` shifts each landing against the line's start. */
function writeWithPalm(
  w: SessionWriter,
  r: Rand,
  o: { lines: number; lineGap?: [number, number]; palmAt?: [number, number]; parts?: number; grows?: boolean },
): PenPlan {
  const plan = planWriting(r, 500, { lines: o.lines, words: 3, lead: lead(w), lineGap: o.lineGap ?? [0, 0] });
  writePlan(w, plan);
  const follow = handFollow(plan);
  const offset = heelOffset(r, side(w), w.options.grip);
  plan.lines.forEach((start, i) => {
    const end = i + 1 < plan.lines.length ? plan.lines[i + 1] - 200 : plan.end;
    const t0 = start + Math.round(between(r, ...(o.palmAt ?? [-60, 200])));
    palm(w, r, { t0, t1: end, follow, offset, parts: o.parts, grows: o.grows, spread: 150 });
  });
  return plan;
}

/** E8's hold: a touch this soon after the pen lifts is held where the hand may be [S16]. */
const AFTER_PEN_HOLD_MS = 1000;

/** A finger of the other hand that lands at t0 at `at`, and moves by (dx, dy) over `ms`. */
function otherFinger(
  w: SessionWriter,
  t0: number,
  at: Vec2,
  move: Vec2,
  ms: number,
  label: {
    intent: 'pan' | 'zoom' | 'scroll' | 'tap' | 'gesture';
    surface?: 'page' | 'chrome';
    size?: Vec2;
    limit?: 'held-after-pen';
  },
): number {
  const size = label.size ?? [9, 8];
  return w.touch({
    t0,
    t1: t0 + ms,
    at: (t) => {
      const f = Math.min(1, Math.max(0, (t - t0 - 30) / Math.max(1, ms - 60)));
      return [at[0] + move[0] * f, at[1] + move[1] * f];
    },
    size: () => size,
    cls: size[0] >= 12 ? 'thumb' : 'finger',
    intent: label.intent,
    surface: label.surface,
    limit: label.limit,
  });
}

/** A two-finger pinch of the other hand: one finger above the other, `gap` apart, spreading by `spread`. */
function otherPinch(w: SessionWriter, r: Rand, t0: number, tip: Vec2, thumb?: Vec2): void {
  const gap = between(r, 30, 50);
  const spread = between(r, 10, 18);
  const a = otherHand(r, side(w), w.options.grip, tip, screen(w), gap + spread);
  otherFinger(w, t0, a, [0, -spread], 450, { intent: 'zoom' });
  otherFinger(w, t0 + between(r, 0, 100), [a[0], a[1] + gap], [0, spread], 450, { intent: 'zoom', size: thumb });
}

export const PEN_SCENARIOS: readonly Scenario[] = [
  pen('restingPalm', (w, r) => void writeWithPalm(w, r, { lines: 2 })),
  pen('palmFirst', (w, r) => void writeWithPalm(w, r, { lines: 1, palmAt: [-400 - lead(w), -50 - lead(w)] })),
  pen('palmGrows', (w, r) => void writeWithPalm(w, r, { lines: 2, grows: true })),
  pen('palmSplit', (w, r) => void writeWithPalm(w, r, { lines: 2, parts: 2 + Math.round(r()) })),
  pen('liftBetweenLines', (w, r) => {
    writeWithPalm(w, r, { lines: 3, lineGap: [300, 1500], palmAt: [-300, 150] });
  }),
  pen('liftBetweenWords', (w, r) => {
    // The pen leaves range after every word and comes back for the next, while the palm stays down.
    const plan = planWriting(r, 500, { lines: 1, words: 4, lead: 0, lineGap: [0, 0], wordGap: [500, 1100] });
    for (const [a, b] of plan.strokes) {
      if (lead(w) > 0) w.hover(a - lead(w), a - 1, plan.pos);
      w.stroke(a, b, plan.pos);
      w.hover(b + 2, b + 40, plan.pos);
      w.leave(b + 45);
    }
    const offset = heelOffset(r, side(w), w.options.grip);
    palm(w, r, { t0: plan.lines[0] + between(r, -60, 200), t1: plan.end, follow: handFollow(plan), offset });
  }),
  pen('thinkPause', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const t = plan.end;
    const pause = between(r, 2500, 6000);
    const second = planWriting(r, t + pause, { lines: 1, words: 2, lead: lead(w), lineGap: [0, 0], y0: 70 });
    w.hover(t - 300, t - 260, plan.pos);
    writePlan(w, second);
    const offset = heelOffset(r, side(w), w.options.grip);
    palm(w, r, { t0: t + between(r, 800, 2000), t1: second.end, follow: handFollow(second), offset });
  }),
  pen('thinkPauseLong', (w, r) => {
    // Over 20 s away: presence is away when the hand comes back, a little before the pen.
    const plan = writeWithPalm(w, r, { lines: 1 });
    const back = plan.end + between(r, 21_000, 30_000);
    const second = planWriting(r, back, { lines: 1, words: 2, lead: lead(w), lineGap: [0, 0], y0: 70 });
    writePlan(w, second);
    const offset = heelOffset(r, side(w), w.options.grip);
    palm(w, r, { t0: back - between(r, 300, 1200), t1: second.end, follow: handFollow(second), offset });
  }),
  pen('restingPinky', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const sx = side(w) === 'left' ? -1 : 1;
    const off: Vec2 = [sx * between(r, 14, 22), between(r, 14, 22)];
    const t0 = plan.strokes[1][0] + 40;
    const follow = handFollow(plan);
    w.touch({
      t0,
      t1: plan.end,
      at: (t) => [follow(t)[0] + off[0], follow(t)[1] + off[1]],
      size: () => [9, 7],
      cls: 'pinky',
      intent: 'none',
    });
  }),
  pen('hookedLefty', (w, r) => void writeWithPalm(w, r, { lines: 2 }), { hand: 'left', grip: 'hooked' }),
  pen('wrongHandedness', (w, r) => void writeWithPalm(w, r, { lines: 2 }), {
    hand: 'left',
    settings: { handedness: 'right' },
  }),
  pen('sleeveBrush', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const [s0, s1] = plan.strokes[1];
    const t0 = Math.round(s0 + (s1 - s0) / 2);
    const sx = side(w) === 'left' ? -1 : 1;
    const [x, y] = plan.pos(t0);
    const from: Vec2 = [x + sx * between(r, 60, 80), y + between(r, 70, 90)];
    w.touch({
      t0,
      t1: t0 + between(r, 40, 80),
      at: (t) => [from[0] - sx * (t - t0) * 0.15, from[1]],
      size: () => [6, 5],
      cls: 'sleeve',
      intent: 'none',
    });
  }),
  pen('knuckleTap', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const t0 = plan.strokes[1][1] + 20;
    const sx = side(w) === 'left' ? -1 : 1;
    const [x, y] = plan.pos(t0);
    const at: Vec2 = [x + sx * between(r, 15, 25), y + between(r, 5, 15)];
    w.touch({
      t0,
      t1: t0 + between(r, 60, 150),
      at: () => at,
      size: () => [10, 8],
      cls: 'knuckle',
      intent: 'none',
    });
  }),
  pen('palmDoubleSettle', (w, r) => doubleSettle(w, r, between(r, 600, 1500))),
  pen('palmDoubleSettleAway', (w, r) => doubleSettle(w, r, between(r, 21_000, 30_000))),
  pen('palmBounceNewLine', (w, r) => {
    // The hand touches down where the next line starts, light, or heavy, before the pen writes it.
    const plan = planWriting(r, 500, { lines: 1, words: 3, lead: lead(w), lineGap: [0, 0] });
    writePlan(w, plan);
    const offset = heelOffset(r, side(w), w.options.grip);
    const t0 = plan.end + between(r, 900, 3000);
    const next: Vec2 = [60, 70];
    const size: Vec2 = r() < 0.5 ? [10, 8] : [40, 30];
    const at: Vec2 = [next[0] + offset[0], next[1] + offset[1]];
    // With no lean, no size, and no palm while it wrote, a hand above the line (hooked, overwriting) is unknown.
    const above = w.options.grip === 'hooked' || w.options.grip === 'overwriter';
    const limit = unknownSide(w) && above ? 'side-unknown' : undefined;
    w.touch({ t0, t1: t0 + 120, at: () => at, size: () => size, cls: 'palm', intent: 'none', limit });
    const second = planWriting(r, t0 + between(r, 300, 900), {
      lines: 1,
      words: 2,
      lead: lead(w),
      lineGap: [0, 0],
      y0: next[1],
    });
    writePlan(w, second);
  }),
  pen('otherHandPinchWhileHover', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const t0 = plan.strokes[plan.strokes.length - 1][1] + 60;
    const tip = plan.pos(t0);
    w.dropLast('pointerleave', 1);
    w.hover(plan.end, plan.end + 900, () => tip);
    otherPinch(w, r, t0 + 60, tip);
  }),
  pen('otherHandEdgePinch', (w, r) => {
    // A pinch whose thumb lands within 5 mm of the bottom edge, after the pen left.
    const plan = writeWithPalm(w, r, { lines: 1 });
    const t0 = plan.end + between(r, 1200, 4000);
    const tip = plan.pos(plan.end - 200);
    const [sw, sh] = screen(w);
    const spread = between(r, 10, 16);
    const covered = (x: number) =>
      handCovers(side(w), w.options.grip, tip, [x, sh - 3]) || handCovers(side(w), w.options.grip, tip, [x, sh - 45]);
    let x = between(r, 20, sw - 20);
    for (let k = 0; k < 50 && covered(x); k++) x = between(r, 20, sw - 20);
    const thumb: Vec2 = [between(r, 13, 18), between(r, 11, 13)];
    otherFinger(w, t0, [x, sh - 45], [0, -spread], 450, { intent: 'zoom' });
    otherFinger(w, t0 + between(r, 0, 100), [x + 4, sh - between(r, 2, 4.5)], [spread, 0], 450, {
      intent: 'zoom',
      size: thumb,
    });
  }),
  pen('otherHandScrollRecent', (w, r) => {
    // From the moment the pen lifts: E8 holds for a second after, and the line anchors cover the next line's start.
    const plan = writeWithPalm(w, r, { lines: 1 });
    const leave = plan.leaves[plan.leaves.length - 1];
    const up = plan.strokes[plan.strokes.length - 1][1] + 1;
    const move = between(r, 30, 60);
    const at = otherHand(r, side(w), w.options.grip, plan.pos(leave - 200), screen(w), 0);
    const from: Vec2 = [at[0], Math.max(at[1], 15 + move)];
    otherFinger(w, up + between(r, 0, 5000), from, [0, -move], 300, { intent: 'scroll' });
  }),
  pen('otherHandTapRecent', (w, r) => {
    // A page tap of the other hand from the moment the pen lifts, clear of the writing hand where it is and where it
    // comes back to start the next line: a tap there is a palm bounce by every signal (palmBounceNewLine).
    const plan = writeWithPalm(w, r, { lines: 1 });
    const up = plan.strokes[plan.strokes.length - 1][1] + 1;
    const tip = plan.pos(up - 1);
    let at = otherHand(r, side(w), w.options.grip, tip, screen(w));
    for (let k = 0; k < 200 && handCovers(side(w), w.options.grip, [60, 70], at); k++) {
      at = otherHand(r, side(w), w.options.grip, tip, screen(w));
    }
    const after = between(r, ...RANGES.afterUpMs);
    otherFinger(w, up + after, at, [0, 0], between(r, 60, 150), {
      intent: 'tap',
      limit: after < AFTER_PEN_HOLD_MS ? 'held-after-pen' : undefined,
    });
  }),
  pen('otherHandPinchRecent', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const up = plan.strokes[plan.strokes.length - 1][1] + 1;
    otherPinch(w, r, up + between(r, ...RANGES.afterUpMs), plan.pos(up - 1));
  }),
  pen('restAlone', (w, r) => restAlone(w, r, between(r, 1000, 15_000))),
  pen('restAloneAway', (w, r) => restAlone(w, r, between(r, 21_000, 30_000))),
  pen('gestureAfterPen', (w, r) => {
    // Two or three fingers of the other hand double-tap, from a second after the pen's last event.
    const plan = writeWithPalm(w, r, { lines: 1 });
    const t0 = plan.end + between(r, ...RANGES.gestureAfterPenMs);
    const fingers = 2 + Math.round(r());
    const gap = between(r, ...RANGES.tapSpacingMm);
    const tip = plan.pos(plan.end - 200);
    const next: Vec2 = [60, 70];
    const clear = (p: Vec2) =>
      !handCovers(side(w), w.options.grip, tip, p) && !handCovers(side(w), w.options.grip, next, p);
    let at: Vec2 = [15, 15];
    for (let k = 0; k < 400; k++) {
      const p = otherHand(r, side(w), w.options.grip, tip, screen(w));
      const row = Array.from({ length: fingers }, (_, f): Vec2 => [p[0] + f * gap, p[1]]);
      if (row.every((q) => q[0] < screen(w)[0] - 10 && clear(q))) {
        at = p;
        break;
      }
    }
    // Without lean or size, the mirror image of the hand is as likely a hand: a tap there is refused.
    const mirror = side(w) === 'left' ? 'right' : 'left';
    const row = Array.from({ length: fingers }, (_, f): Vec2 => [at[0] + f * gap, at[1]]);
    const blind =
      unknownSide(w) && row.some((q) => handCovers(mirror, 'tripod', tip, q) || handCovers(mirror, 'tripod', next, q));
    doubleTap(w, r, t0, at, gap, fingers, blind ? 'side-unknown' : undefined);
  }),
  pen(
    'fingerAfterPen',
    (w, r) => {
      // "Draw with finger: on": the pen writes, then a finger writes a word and a dot from half a second to 30 s later.
      const plan = planWriting(r, 500, { lines: 1, words: 2, lead: lead(w), lineGap: [0, 0] });
      writePlan(w, plan);
      const last = plan.pos(plan.strokes[plan.strokes.length - 1][1]);
      const spots: Vec2[] = [
        [0, 25],
        [25, 45],
        [-50, -40],
      ];
      const spot = spots[Math.floor(r() * spots.length)];
      const at: Vec2 = [
        Math.max(15, Math.min(screen(w)[0] - 45, last[0] + spot[0])),
        Math.max(15, Math.min(screen(w)[1] - 15, last[1] + spot[1])),
      ];
      const t0 = plan.end + between(r, 600, 30_000);
      tipStroke(w, r, t0, at);
      dot(w, r, t0 + 400 + between(r, 150, 400), [at[0] + 10, at[1] - 6]);
    },
    { settings: { fingerDraw: 'on' } },
  ),
  pen('otherHandChromeTap', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const t0 = plan.strokes[plan.strokes.length - 1][1] + 60;
    const tip = plan.pos(t0);
    w.dropLast('pointerleave', 1);
    w.hover(plan.end, plan.end + 600, () => tip);
    otherFinger(w, t0 + 50, otherHand(r, side(w), w.options.grip, tip, screen(w)), [0, 0], between(r, 80, 150), {
      intent: 'tap',
      surface: 'chrome',
    });
  }),
  pen('palmOnPalette', (w, r) => {
    const plan = planWriting(r, 500, { lines: 1, words: 3, lead: lead(w), lineGap: [0, 0] });
    writePlan(w, plan);
    const offset = heelOffset(r, side(w), w.options.grip);
    palm(w, r, { t0: plan.lines[0] + 80, t1: plan.end, follow: handFollow(plan), offset, surface: 'chrome' });
  }),
  pen('penOverToolbar', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const t = plan.end - 120;
    w.hover(t, t + 1200, (at) => [plan.pos(t)[0], Math.max(4, 60 - (at - t) / 10)]);
    const offset = heelOffset(r, side(w), w.options.grip);
    const [x, y] = plan.pos(t);
    palm(w, r, { t0: t + between(r, 600, 900), t1: t + 1400, follow: () => [x, y], offset });
  }),
  pen('noHoverFirstContact', (w, r) => {
    const plan = planWriting(r, 500, { lines: 1, words: 3, lead: 0, lineGap: [0, 0] });
    for (const [a, b] of plan.strokes) w.stroke(a, b, plan.pos);
    w.leave(plan.end);
    palm(w, r, {
      t0: 500 - between(r, 100, 400),
      t1: plan.end,
      follow: handFollow(plan),
      offset: heelOffset(r, side(w), w.options.grip),
    });
  }),
  pen(
    'hoverPenFastFirstTap',
    (w, r) => {
      const plan = planWriting(r, 500, { lines: 1, words: 1, lead: 0, lineGap: [0, 0] });
      writePlan(w, plan);
      otherFinger(w, plan.end + 25_000, [120, 120], [0, -40], 300, { intent: 'scroll' });
    },
    { penSeen: false },
  ),
  pen('swapPens', (w, r) => {
    const first = planWriting(r, 500, { lines: 1, words: 2, lead: lead(w), lineGap: [0, 0] });
    writePlan(w, first, 1);
    const second = planWriting(r, first.end + 400, { lines: 1, words: 2, lead: lead(w), lineGap: [0, 0], y0: 75 });
    writePlan(w, second, 2);
    const offset = heelOffset(r, side(w), w.options.grip);
    palm(w, r, { t0: first.lines[0] + 100, t1: first.end, follow: handFollow(first), offset });
    palm(w, r, { t0: second.lines[0] + 100, t1: second.end, follow: handFollow(second), offset });
  }),
  pen('lostUp', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const t = plan.end + 300;
    w.stroke(t, t + 300, () => [150, 60], 3);
    w.dropLast('pointerup', 3);
    otherFinger(w, t + 12_000, [40, 120], [0, -40], 300, { intent: 'scroll' });
  }),
  pen('lostLeave', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    w.dropLast('pointerleave', 1);
    otherFinger(w, plan.end + 8000, [40, 120], [0, -40], 300, { intent: 'scroll' });
  }),
  pen('lostTouchEnd', (w, r) => {
    const plan = planWriting(r, 500, { lines: 1, words: 3, lead: lead(w), lineGap: [0, 0] });
    writePlan(w, plan);
    const follow = handFollow(plan);
    const offset = heelOffset(r, side(w), w.options.grip);
    w.touch({
      t0: plan.lines[0] + 100,
      t1: plan.end,
      at: (t) => [follow(t)[0] + offset[0], follow(t)[1] + offset[1]],
      size: () => [45, 30],
      cls: 'palm',
      intent: 'none',
      lostEnd: true,
    });
    otherFinger(w, plan.end + 12_000, [40, 120], [0, -40], 300, { intent: 'scroll' });
  }),
  pen('osCancelLate', (w, r) => {
    const plan = planWriting(r, 500, { lines: 1, words: 3, lead: lead(w), lineGap: [0, 0] });
    writePlan(w, plan);
    const follow = handFollow(plan);
    const offset = heelOffset(r, side(w), w.options.grip);
    const t0 = plan.lines[0] + 60;
    w.touch({
      t0,
      t1: plan.end,
      at: (t) => [follow(t)[0] + offset[0], follow(t)[1] + offset[1]],
      size: () => [12, 10],
      cls: 'palm',
      intent: 'none',
      cancelAt: t0 + between(r, 200, 400),
    });
  }),
  pen('zeroPressureEnds', (w, r) => void writeWithPalm(w, r, { lines: 2 }), { writer: { zeroPressureEnds: true } }),
  pen('coalescedBatches', (w, r) => void writeWithPalm(w, r, { lines: 2, parts: 2 }), { writer: { rateHz: 480 } }),
  pen('fingerDrawOnPenDevice', (w, r) => void words(w, r, 300, 4), { settings: { fingerDraw: 'on' } }),
  pen(
    'palmBounceBeforePen',
    (w, r) => {
      const off = heelOffset(r, side(w), w.options.grip);
      const tip: Vec2 = [90, 70];
      const t1 = 300 + between(r, 100, 200);
      const at: Vec2 = [tip[0] + off[0], tip[1] + off[1]];
      const size: Vec2 = [between(r, 35, 50), 28];
      w.touch({ t0: 300, t1, at: () => at, size: () => size, cls: 'palm', intent: 'none' });
      const start = t1 + between(r, 300, 900);
      writePlan(
        w,
        planWriting(r, start, { lines: 1, words: 2, lead: lead(w), lineGap: [0, 0], x0: tip[0], y0: tip[1] }),
      );
    },
    // The bounce's one tell before the pen is its size. A digitizer without sizes sees a finger dot, the known limit of
    // finger drawing (palm README); there the pen's late retract takes the dot back, and the dot hold measures it.
    { settings: { fingerDraw: 'on' }, when: (p) => p.size !== 'none' && p.size !== 'constant' },
  ),
  pen('gripThumbEdge', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const at: Vec2 = [between(r, 1, 3), between(r, 60, 120)];
    w.touch({
      t0: 300,
      t1: plan.end,
      at: () => at,
      size: () => [16, 10],
      cls: 'grip-thumb',
      intent: 'none',
    });
  }),
  pen(
    'penAsMouseFirstUse',
    (w, r) => {
      // No pen seen yet, so fingers would draw; the pen arrives as a mouse while the hand rests and slides.
      const plan = planWriting(r, 500, { lines: 1, words: 3, lead: lead(w), lineGap: [0, 0] });
      writePlan(w, plan);
      const follow = handFollow(plan);
      const offset = heelOffset(r, side(w), w.options.grip);
      palm(w, r, { t0: 300, t1: plan.end, follow, offset });
      const pinky: Vec2 = [offset[0] * 0.5, offset[1] * 0.4];
      w.touch({
        t0: 320,
        t1: plan.end,
        at: (t) => [follow(t)[0] + pinky[0], follow(t)[1] + pinky[1]],
        size: () => [10, 8],
        cls: 'pinky',
        intent: 'none',
      });
    },
    { penSeen: false, only: ['wacom-emr-mouse'] },
  ),
];

/** The writing hand rests where the next line starts, `after` ms after the pen leaves, and lifts. No pen follows. */
function restAlone(w: SessionWriter, r: Rand, after: number): void {
  const plan = writeWithPalm(w, r, { lines: 1 });
  const t0 = plan.end + after;
  const offset = heelOffset(r, side(w), w.options.grip);
  palm(w, r, { t0, t1: t0 + between(r, 600, 3000), follow: () => [60, 70], offset, spread: 150 });
}

/** A palm that settles twice as two contacts, at the palm of the next line, `after` ms after the pen leaves. */
function doubleSettle(w: SessionWriter, r: Rand, after: number): void {
  const plan = writeWithPalm(w, r, { lines: 1 });
  const leave = plan.leaves[plan.leaves.length - 1];
  const off = heelOffset(r, side(w), w.options.grip);
  const next: Vec2 = [60, 70];
  // With no lean and no size, a hand above the line (hooked, overwriting) is where nothing expects it.
  const above = w.options.grip === 'hooked' || w.options.grip === 'overwriter';
  const limit = unknownSide(w) && w.profile.size !== 'real' && above ? 'side-unknown' : undefined;
  let t = leave + after;
  for (let hop = 0; hop < 2; hop++) {
    for (const [dx, dy] of [
      [0, 0],
      [-14, -10],
    ] as const) {
      const at: Vec2 = [next[0] + off[0] + dx, next[1] + off[1] + dy];
      const spot = { t0: t + Math.abs(dx), t1: t + 120, at: () => at, size: (): Vec2 => [40, 30] } as const;
      w.touch({ ...spot, cls: 'palm', intent: 'none', limit });
    }
    t += 200;
  }
  const second = planWriting(r, t + between(r, 50, 700), {
    lines: 1,
    words: 1,
    lead: lead(w),
    lineGap: [0, 0],
    y0: next[1],
  });
  writePlan(w, second);
}

export const SCENARIOS: readonly Scenario[] = [...PEN_SCENARIOS, ...TOUCH_SCENARIOS];

/** Whether a scenario runs on a profile. */
export function applies(s: Scenario, p: SimProfile): boolean {
  if (s.only) return s.only.includes(p.id);
  if (s.when && !s.when(p)) return false;
  if (s.kind === 'pen') return p.stylus === 'pen';
  if (s.name === 'phoneFingerOnly') return p.id === 'phone-finger';
  return p.stylus !== 'pen';
}

/** The hands a scenario runs with: its own, or each hand. */
export function handsOf(s: Scenario): readonly ('right' | 'left')[] {
  return s.hand ? [s.hand] : ['right', 'left'];
}

const GRIPS: readonly Grip[] = ['tripod', 'hooked', 'overwriter', 'fist'];

export function generate(s: Scenario, p: SimProfile, seed: number, hand = s.hand ?? 'right'): Session {
  let hash = seed * 7919;
  for (const ch of `${s.name}/${p.id}${hand === 'left' && !s.hand ? '/left' : ''}`) {
    hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0;
  }
  const r = seeded(hash);
  const w = new SessionWriter(p, r, {
    handedness: hand,
    // The seeds turn through the four grips, so every scenario runs each grip with each hand on every profile.
    grip: s.grip ?? GRIPS[(seed - 1) % GRIPS.length],
    settings: s.settings ?? {},
    learned: { ...EMPTY_LEARNED, penSeen: s.penSeen ?? s.kind === 'pen' },
    task: s.name,
    ...s.writer,
  });
  w.tool(true, 0);
  s.build(w, r);
  return w.build();
}
