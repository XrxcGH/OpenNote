// Adversarial scenarios (palm README, "Measurement"). Each builds a labeled session on a simulated device from a
// seed. Pen scenarios run on every pen profile, touch scenarios on every finger and passive stylus profile. Every
// contact is labeled with what it was and what the person meant, which is the oracle the metrics check.

import { EMPTY_LEARNED } from '../palm/index';
import type { PalmSettings } from '../palm/index';
import { farSide, handFollow, heelOffset, palm, planWriting, writePlan } from './hands';
import type { PenPlan } from './hands';
import type { SimProfile } from './profiles';
import type { Grip, Session } from './session';
import { between, SessionWriter, seeded } from './writer';
import type { Rand, Vec2 } from './writer';

export interface Scenario {
  readonly name: string;
  readonly kind: 'pen' | 'touch';
  readonly hand?: 'right' | 'left';
  readonly grip?: Grip;
  readonly settings?: Partial<PalmSettings>;
  /** Whether this device has used a pen before the session. Pen scenarios default to yes. */
  readonly penSeen?: boolean;
  readonly build: (w: SessionWriter, r: Rand) => void;
}

const lead = (w: SessionWriter) => (w.profile.hover === 'none' ? 0 : w.profile.hoverLeadMs);
const side = (w: SessionWriter) => w.options.handedness;

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

/** A finger of the other hand that lands at t0 on the far side of point `from`, and moves by (dx, dy) over `ms`. */
function otherFinger(
  w: SessionWriter,
  t0: number,
  at: Vec2,
  move: Vec2,
  ms: number,
  label: { intent: 'pan' | 'zoom' | 'scroll' | 'tap' | 'gesture'; surface?: 'page' | 'chrome' },
): number {
  return w.touch({
    t0,
    t1: t0 + ms,
    at: (t) => {
      const f = Math.min(1, Math.max(0, (t - t0 - 30) / Math.max(1, ms - 60)));
      return [at[0] + move[0] * f, at[1] + move[1] * f];
    },
    size: () => [9, 8],
    cls: 'finger',
    intent: label.intent,
    surface: label.surface,
  });
}

const pen = (name: string, build: Scenario['build'], extra: Partial<Scenario> = {}): Scenario => ({
  name,
  kind: 'pen',
  build,
  ...extra,
});
const touch = (name: string, build: Scenario['build'], extra: Partial<Scenario> = {}): Scenario => ({
  name,
  kind: 'touch',
  build,
  ...extra,
});

export const PEN_SCENARIOS: readonly Scenario[] = [
  pen('restingPalm', (w, r) => void writeWithPalm(w, r, { lines: 2 })),
  pen('palmFirst', (w, r) => void writeWithPalm(w, r, { lines: 1, palmAt: [-400 - lead(w), -50 - lead(w)] })),
  pen('palmGrows', (w, r) => void writeWithPalm(w, r, { lines: 2, grows: true })),
  pen('palmSplit', (w, r) => void writeWithPalm(w, r, { lines: 2, parts: 2 + Math.round(r()) })),
  pen('liftBetweenLines', (w, r) => {
    writeWithPalm(w, r, { lines: 3, lineGap: [300, 1500], palmAt: [-300, 150] });
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
    w.touch({
      t0,
      t1: t0 + between(r, 60, 150),
      at: () => [x + sx * between(r, 15, 25), y + between(r, 5, 15)],
      size: () => [10, 8],
      cls: 'knuckle',
      intent: 'none',
    });
  }),
  pen('palmDoubleSettle', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const leave = plan.leaves[plan.leaves.length - 1];
    const [x, y] = plan.pos(leave - 200);
    const off = heelOffset(r, side(w), w.options.grip);
    let t = leave + between(r, 600, 1500);
    for (let hop = 0; hop < 2; hop++) {
      for (const [dx, dy] of [
        [0, 0],
        [-14, -10],
      ] as const) {
        const at: Vec2 = [x + off[0] + dx, y + off[1] + dy];
        w.touch({ t0: t + Math.abs(dx), t1: t + 120, at: () => at, size: () => [40, 30], cls: 'palm', intent: 'none' });
      }
      t += 200;
    }
  }),
  pen('otherHandPinchWhileHover', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const t0 = plan.strokes[plan.strokes.length - 1][1] + 60;
    const tip = plan.pos(t0);
    w.dropLast('pointerleave', 1);
    w.hover(plan.end, plan.end + 900, () => tip);
    const a = farSide(side(w), tip, between(r, 80, 110));
    const gap = between(r, 30, 50);
    const spread = between(r, 10, 18);
    otherFinger(w, t0 + 60, a, [0, -spread], 450, { intent: 'zoom' });
    otherFinger(w, t0 + 60 + between(r, 0, 100), [a[0], a[1] + gap], [0, spread], 450, { intent: 'zoom' });
  }),
  pen('otherHandScrollRecent', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const leave = plan.leaves[plan.leaves.length - 1];
    const at = farSide(side(w), plan.pos(leave - 200), between(r, 70, 110));
    otherFinger(w, leave + between(r, 1000, 5000), at, [0, -between(r, 30, 60)], 300, { intent: 'scroll' });
  }),
  pen('otherHandChromeTap', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const t0 = plan.strokes[plan.strokes.length - 1][1] + 60;
    const tip = plan.pos(t0);
    w.dropLast('pointerleave', 1);
    w.hover(plan.end, plan.end + 600, () => tip);
    otherFinger(w, t0 + 50, farSide(side(w), tip, between(r, 80, 110)), [0, 0], between(r, 80, 150), {
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
  pen('fingerDrawOnPenDevice', (w, r) => void words(w, r, 300, 4), { settings: { fingerDraw: 'on' } }),
  pen(
    'palmBounceBeforePen',
    (w, r) => {
      const off = heelOffset(r, side(w), w.options.grip);
      const tip: Vec2 = [90, 70];
      const t1 = 300 + between(r, 100, 200);
      const at: Vec2 = [tip[0] + off[0], tip[1] + off[1]];
      w.touch({ t0: 300, t1, at: () => at, size: () => [between(r, 35, 50), 28], cls: 'palm', intent: 'none' });
      const start = t1 + between(r, 300, 900);
      writePlan(
        w,
        planWriting(r, start, { lines: 1, words: 2, lead: lead(w), lineGap: [0, 0], x0: tip[0], y0: tip[1] }),
      );
    },
    { settings: { fingerDraw: 'on' } },
  ),
  pen('gripThumbEdge', (w, r) => {
    const plan = writeWithPalm(w, r, { lines: 1 });
    const y = between(r, 60, 120);
    w.touch({
      t0: 300,
      t1: plan.end,
      at: () => [between(r, 1, 3), y],
      size: () => [16, 10],
      cls: 'grip-thumb',
      intent: 'none',
    });
  }),
];

/** A finger or stylus tip stroke: lands at t0 and draws a short word. */
function tipStroke(w: SessionWriter, r: Rand, t0: number, at: Vec2, ms = 400, cutAt?: number): number {
  const tip = w.profile.id === 'passive-stylus' ? between(r, 3.5, 6) : between(r, 7, 10);
  const len = between(r, 15, 30);
  return w.touch({
    t0,
    t1: t0 + ms,
    at: (t) => {
      const f = (t - t0) / ms;
      return [at[0] + len * f, at[1] + 2.5 * Math.sin(f * 6)];
    },
    size: () => [tip, tip * 0.9],
    cls: w.profile.id === 'passive-stylus' ? 'pen' : 'finger',
    intent: 'ink',
    cancelAt: cutAt,
    stepMs: 10,
  });
}

function restingHand(w: SessionWriter, r: Rand, t0: number, t1: number, tip: Vec2, small = false): void {
  const sx = side(w) === 'left' ? -1 : 1;
  const at: Vec2 = [tip[0] + sx * between(r, 25, 35), tip[1] + between(r, 28, 40)];
  const size = small
    ? (t: number): Vec2 => (t - t0 < 300 ? [between(r, 9, 11), 8] : [between(r, 30, 45), 25])
    : () => [between(r, 35, 55), 28] as Vec2;
  w.touch({ t0, t1, at: () => at, size, cls: 'palm', intent: 'none', stepMs: 16 });
}

const words = (w: SessionWriter, r: Rand, t0: number, n: number, y = 60): number => {
  let t = t0;
  for (let i = 0; i < n; i++) {
    tipStroke(w, r, t, [30 + i * 30, y]);
    t += 400 + between(r, 150, 400);
  }
  return t;
};

function fingerTaps(w: SessionWriter, r: Rand, t0: number, fingers: number): void {
  for (let hop = 0; hop < 2; hop++) {
    const t = t0 + hop * between(r, 200, 300);
    for (let k = 0; k < fingers; k++) {
      const at: Vec2 = [40 + k * 22, 80];
      w.touch({ t0: t + k * 15, t1: t + 120, at: () => at, size: () => [9, 8], cls: 'finger', intent: 'gesture' });
    }
  }
}

export const TOUCH_SCENARIOS: readonly Scenario[] = [
  touch('fingerDraw', (w, r) => void words(w, r, 300, 5)),
  touch('fingerDrawKnuckles', (w, r) => {
    restingHand(w, r, 100, 3500, [60, 60]);
    words(w, r, 400, 4);
  }),
  touch('passiveStylusPalmFirst', (w, r) => {
    restingHand(w, r, 100, 3000, [45, 60]);
    words(w, r, 100 + between(r, 300, 500), 3);
  }),
  touch('passiveStylusSmallPalmFirst', (w, r) => {
    restingHand(w, r, 100, 3000, [45, 60], true);
    words(w, r, 100 + between(r, 300, 500), 3);
  }),
  touch('fingerDrawLatePinch', (w, r) => {
    const t0 = 300;
    const late = [140, 160, 250][Math.floor(r() * 3)];
    const spread = between(r, 12, 20);
    const thumb: Vec2 = [60 - between(r, 10, 20), 80 + between(r, 30, 45)];
    const grow = (t: number) => Math.max(0, t - t0 - late - 40) * (spread / 400);
    w.touch({
      t0,
      t1: t0 + late + 500,
      at: (t) => [60, 80 - grow(t)],
      size: () => [9, 8],
      cls: 'finger',
      intent: 'zoom',
    });
    w.touch({
      t0: t0 + late,
      t1: t0 + late + 500,
      at: (t) => [thumb[0], thumb[1] + grow(t)],
      size: () => [10, 9],
      cls: 'thumb',
      intent: 'zoom',
    });
  }),
  touch('phoneFingerOnly', (w, r) => void words(w, r, 300, 4)),
  touch('threeFingerTapInDrawMode', (w, r) => fingerTaps(w, r, 300, 3)),
  touch('twoFingerDoubleTap', (w, r) => fingerTaps(w, r, 300, 2)),
  touch('blurMidStroke', (w, r) => {
    const end = words(w, r, 300, 2);
    tipStroke(w, r, end, [30, 90], 600, end + 301);
    w.system('blur', end + 300);
    w.system('focus', end + 2000);
  }),
  touch('pageSwitchMidStroke', (w, r) => {
    const end = words(w, r, 300, 2);
    tipStroke(w, r, end, [30, 90], 600, end + 301);
    w.system('pageswitch', end + 300);
  }),
  touch('gripThumbEdge', (w, r) => {
    const y = between(r, 60, 120);
    w.touch({
      t0: 100,
      t1: 3500,
      at: () => [between(r, 1, 3), y],
      size: () => [16, 10],
      cls: 'grip-thumb',
      intent: 'none',
    });
    words(w, r, 400, 4);
  }),
];

export const SCENARIOS: readonly Scenario[] = [...PEN_SCENARIOS, ...TOUCH_SCENARIOS];

/** Whether a scenario runs on a profile. */
export function applies(s: Scenario, p: SimProfile): boolean {
  if (s.kind === 'pen') return p.stylus === 'pen';
  if (s.name === 'phoneFingerOnly') return p.id === 'phone-finger';
  if (s.name.startsWith('passiveStylus')) return p.stylus !== 'pen';
  return p.stylus !== 'pen';
}

export function generate(s: Scenario, p: SimProfile, seed: number): Session {
  let hash = seed * 7919;
  for (const ch of `${s.name}/${p.id}`) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0;
  const r = seeded(hash);
  const w = new SessionWriter(p, r, {
    handedness: s.hand ?? 'right',
    grip: s.grip ?? 'tripod',
    settings: s.settings ?? {},
    learned: { ...EMPTY_LEARNED, penSeen: s.penSeen ?? s.kind === 'pen' },
    task: s.name,
  });
  w.tool(true, 0);
  s.build(w, r);
  return w.build();
}
