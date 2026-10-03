// A seeded model of a writing hand and of handwriting. The pen plan writes words along lines, hovering between words
// and leaving range between lines. The hand places palm heel, pinky, and knuckle contacts relative to the pen tip by
// handedness and grip, with physical sizes, growth after landing, drift of the centroid while a palm settles, and
// splitting into several contacts. Its ranges (`RANGES`) straddle every classifier threshold they meet rather than sit
// on one side of them, and a test holds them to that. Palms grow to 10 to 60 mm and drift 0 to 20 mm. The other hand
// lands anywhere outside the writing hand from the moment the pen lifts.

import { palmThresholds } from '../palm/index';
import type { Grip } from './session';
import type { SimProfile } from './profiles';
import type { Rand, SessionWriter, Vec2 } from './writer';
import { between } from './writer';

/**
 * The generators' ranges, each across the thresholds it meets, as a test checks. Drift crosses slop and a settling
 * palm's travel. Size crosses a fingertip, a thumb, and a palm. The time after the pen lifts crosses both E8 windows.
 * Tap spacing reaches the spacing of a palm's parts.
 */
export const RANGES = {
  palmDriftMm: [0, 20],
  palmMajorMm: [10, 60],
  /** Other-hand scroll, tap, and pinch, after the pen lifts. */
  afterUpMs: [0, 5000],
  /** Multi-finger taps, after the pen's last event: the design waits a second. */
  gestureAfterPenMs: [1000, 30_000],
  tapSpacingMm: [15.5, 40],
  palmParts: [1, 3],
} as const;

/**
 * The known limits a generated contact can fall under (palm README, "Known limits"), each the design's own bound of
 * what a page can see. A contact so labeled has no tell: its faults, and intents lost beside it, are reported apart
 * from the gates. known-limits.json lists the same reasons.
 */
export const LIMITS = {
  'slides-like-a-stroke':
    'A palm part that slides 10 mm or more as it lands (further than a palm settles) and is smaller than a palm, ' +
    'or on a digitizer without sizes: a stroke or a scroll by every signal until a pen or a neighbour tells.',
  bounce:
    'A palm part down for under 300 ms, smaller than a palm or on a digitizer without sizes, that moves less than ' +
    'a palm settles: a dot or a quick short mark by every signal.',
  'fingertip-sized':
    'A palm part that grows no larger than a fingertip (11 mm): a finger by its size, so alone it draws or scrolls ' +
    'like one.',
  'held-after-pen':
    'A tap of the other hand within a second of the pen lifting: E8 holds it where the hand may be, anywhere while ' +
    'the side of the hand is unknown [S16].',
  'side-unknown':
    'A pen that reports neither lean nor contact size, with no palm resting while it wrote: the hand may lie on ' +
    'either side, or above the line for a hooked or overwriting grip, so a touch there is refused.',
} as const;
export type Limit = keyof typeof LIMITS;

const { FINGERTIP_MAJOR_MM, PALM_MAJOR_MM, RADIUS_STEP_MM, SETTLE_TRAVEL_MM } = palmThresholds;
/** The longest touch that is a bounce. */
const BOUNCE_MS = 300;

const sizeless = (p: SimProfile) => p.size === 'none' || p.size === 'constant';

/**
 * The limit a palm part falls under, if any: it slides like a stroke, or bounces like a dot, and is smaller than a palm
 * or on a digitizer that cannot tell.
 */
export function palmLimit(p: SimProfile, s: PalmShape, scale: number, ms: number): Limit | undefined {
  const actual = sizeAt(s, 0, ms, scale)[0];
  // A digitizer that reports one radius rounds it in steps, and tells a palm one step higher.
  const quantized = p.size === 'quantized';
  const size = quantized ? Math.round(actual / RADIUS_STEP_MM) * RADIUS_STEP_MM : actual;
  const palmAt = quantized ? PALM_MAJOR_MM + RADIUS_STEP_MM : PALM_MAJOR_MM;
  if (!sizeless(p) && size >= palmAt) return undefined;
  if (s.drift >= SETTLE_TRAVEL_MM) return 'slides-like-a-stroke';
  if (ms < BOUNCE_MS) return 'bounce';
  return !sizeless(p) && size <= FINGERTIP_MAJOR_MM ? 'fingertip-sized' : undefined;
}

export interface PenPlan {
  readonly strokes: readonly (readonly [number, number])[];
  readonly hovers: readonly (readonly [number, number])[];
  readonly leaves: readonly number[];
  /** Line starts: the first stroke of each line. */
  readonly lines: readonly number[];
  readonly pos: (t: number) => Vec2;
  readonly start: number;
  readonly end: number;
}

interface Key {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly ink: boolean;
}

export interface PlanOptions {
  readonly lines: number;
  readonly words: number;
  /** Hover before the first contact, ms. 0 for a pen without hover. */
  readonly lead: number;
  /** The pen leaves range between lines for this long, or stays hovering when 0. */
  readonly lineGap: readonly [number, number];
  readonly wordGap?: readonly [number, number];
  readonly x0?: number;
  readonly y0?: number;
  /** Left-handed writers move the same way; hooked writers too. Lines go down the page. */
  readonly lineStep?: number;
}

/** Plans handwriting from time t0: words of 12 to 30 mm written in 250 to 700 ms each. */
export function planWriting(r: Rand, t0: number, o: PlanOptions): PenPlan {
  const keys: Key[] = [];
  const strokes: [number, number][] = [];
  const hovers: [number, number][] = [];
  const leaves: number[] = [];
  const lines: number[] = [];
  let t = t0 + o.lead;
  const x0 = o.x0 ?? 60;
  let y = o.y0 ?? 60;
  if (o.lead > 0) hovers.push([t0, t - 1]);
  keys.push({ t: t0, x: x0 - 4, y: y - 3, ink: false });
  for (let line = 0; line < o.lines; line++) {
    let x = x0;
    lines.push(t);
    for (let word = 0; word < o.words; word++) {
      const len = between(r, 12, 30);
      const dur = Math.round(between(r, 250, 700));
      keys.push({ t, x, y, ink: true }, { t: t + dur, x: x + len, y, ink: false });
      strokes.push([t, t + dur]);
      x += len + between(r, 5, 10);
      const gap = Math.round(between(r, ...(o.wordGap ?? [80, 300])));
      if (word < o.words - 1) hovers.push([t + dur + 2, t + dur + gap - 2]);
      t += dur + gap;
    }
    if (line === o.lines - 1) break;
    const away = Math.round(between(r, ...o.lineGap));
    if (away > 0) {
      hovers.push([t - 2, t + 40]);
      leaves.push(t + 45);
      t += away;
      if (o.lead > 0) hovers.push([t - o.lead, t - 1]);
    } else {
      hovers.push([t - 2, t + 300]);
      t += 300;
    }
    y += o.lineStep ?? 10;
    keys.push({ t: t - 1, x: x0 - 3, y: y - 2, ink: false });
  }
  hovers.push([t, t + 120]);
  leaves.push(t + 130);
  const pos = (at: number): Vec2 => {
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t <= at) i++;
    const a = keys[i];
    const b = keys[i + 1] ?? a;
    const f = b.t > a.t ? Math.min(1, Math.max(0, (at - a.t) / (b.t - a.t))) : 0;
    const wiggle = a.ink ? 2.5 * Math.sin(((at - a.t) / 140) * 2 * Math.PI) : 0;
    return [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f + wiggle];
  };
  return { strokes, hovers, leaves, lines, pos, start: t0, end: t + 130 };
}

/** Emits a plan's hovers, strokes, and leaves. */
export function writePlan(w: SessionWriter, plan: PenPlan, id = 1): void {
  for (const [a, b] of plan.hovers) w.hover(a, b, plan.pos, id);
  for (const [a, b] of plan.strokes) w.stroke(a, b, plan.pos, id);
  for (const t of plan.leaves) w.leave(t, id);
}

/** Where the palm heel sits relative to the pen tip, in mm, for a hand and grip. */
export function heelOffset(r: Rand, hand: 'right' | 'left', grip: Grip): Vec2 {
  const sx = hand === 'left' ? -1 : 1;
  switch (grip) {
    case 'hooked':
      return [sx * between(r, 30, 45), -between(r, 30, 42)];
    case 'overwriter':
      return [sx * between(r, 25, 35), -between(r, 15, 25)];
    case 'fist':
      return [sx * between(r, 25, 40), between(r, 30, 42)];
    default:
      return [sx * between(r, 35, 50), between(r, 40, 55)];
  }
}

export interface PalmShape {
  readonly major: number;
  readonly minor: number;
  /** Size at landing, mm, and how long it takes to reach full size. */
  readonly initial: number;
  readonly growMs: number;
  /** How far the centroid drifts while the contact grows, mm, away from the fingers. */
  readonly drift: number;
}

export function palmShape(r: Rand, grows = false, drift: readonly [number, number] = RANGES.palmDriftMm): PalmShape {
  const major = between(r, ...RANGES.palmMajorMm);
  const initial = Math.min(major, grows ? between(r, 7, 11) : between(r, 8, 30));
  return {
    major,
    minor: major * between(r, 0.6, 0.8),
    initial,
    growMs: between(r, 60, 250),
    drift: between(r, ...drift),
  };
}

/** The drift of a settling palm at t: it grows toward the heel, so its centroid moves away from the fingers. */
export function driftAt(s: PalmShape, t0: number, t: number, dir: Vec2): Vec2 {
  const f = Math.min(1, Math.max(0, (t - t0) / s.growMs));
  return [dir[0] * s.drift * f, dir[1] * s.drift * f];
}

/** A unit vector along an offset, turned by up to 45 degrees either way. */
export function awayFrom(r: Rand, offset: Vec2): Vec2 {
  const a = Math.atan2(offset[1], offset[0]) + between(r, -Math.PI / 4, Math.PI / 4);
  return [Math.cos(a), Math.sin(a)];
}

export function sizeAt(s: PalmShape, t0: number, t: number, scale = 1): Vec2 {
  const f = s.growMs <= 0 ? 1 : Math.min(1, (t - t0) / s.growMs);
  const major = (s.initial + (s.major - s.initial) * f) * scale;
  const minor = (s.initial * 0.8 + (s.minor - s.initial * 0.8) * f) * scale;
  return [Math.max(major, minor), Math.min(major, minor)];
}

/** Parts of a palm that a digitizer may split it into: heel, then the pinky side, then the wrist. */
export const PALM_PARTS: readonly { readonly dx: number; readonly dy: number; readonly scale: number }[] = [
  { dx: 0, dy: 0, scale: 1 },
  { dx: -14, dy: -10, scale: 0.5 },
  { dx: 10, dy: 22, scale: 0.6 },
];

export interface PalmOptions {
  readonly t0: number;
  readonly t1: number;
  readonly follow: (t: number) => Vec2;
  readonly offset: Vec2;
  readonly parts?: number;
  readonly grows?: boolean;
  readonly surface?: 'page' | 'chrome';
  /** Spread of the parts' landing times, ms. */
  readonly spread?: number;
  /** How far the centroid drifts while it settles, mm. */
  readonly drift?: readonly [number, number];
}

/**
 * A resting palm that follows the pen: it slides with the writing hand and stays planted while the pen hovers.
 * Returns the contact ids.
 */
export function palm(w: SessionWriter, r: Rand, o: PalmOptions): number[] {
  const shape = palmShape(r, o.grows, o.drift);
  const dir = awayFrom(r, o.offset);
  const ids: number[] = [];
  const mirror = o.offset[0] < 0 ? -1 : 1;
  const [few, many] = RANGES.palmParts;
  const parts = Math.max(few, Math.min(many, o.parts ?? few + Math.floor(r() * (many - few + 1))));
  for (let k = 0; k < parts; k++) {
    const part = PALM_PARTS[k];
    const t0 = o.t0 + (k === 0 ? 0 : between(r, 0, o.spread ?? 150));
    const at = (t: number): Vec2 => {
      const [px, py] = o.follow(t);
      const [dx, dy] = driftAt(shape, t0, t, dir);
      return [px + o.offset[0] + part.dx * mirror + dx, py + o.offset[1] + part.dy + dy];
    };
    const id = w.touch({
      t0,
      t1: o.t1,
      at,
      size: (t) => sizeAt(shape, t0, t, part.scale),
      cls: k === 2 ? 'wrist' : 'palm',
      intent: 'none',
      limit: palmLimit(w.profile, shape, part.scale, o.t1 - t0),
      surface: o.surface,
      cancelAt: w.osCancel(t0),
      stepMs: 14,
    });
    if (id >= 0) ids.push(id);
  }
  return ids;
}

/**
 * Where a resting hand is: planted while a word is written, since the fingers write it, then sliding to the next
 * word's start while the pen hovers between words.
 */
export function handFollow(plan: PenPlan): (t: number) => Vec2 {
  const starts = plan.strokes.map(([a]) => a);
  return (t) => {
    let k = 0;
    while (k < starts.length - 1 && starts[k + 1] <= t) k++;
    const [ax, ay] = plan.pos(starts[k]);
    const end = plan.strokes[k][1];
    if (t <= end || k === starts.length - 1) return [ax, ay];
    const [bx, by] = plan.pos(starts[k + 1]);
    const f = Math.min(1, (t - end) / Math.max(1, starts[k + 1] - end));
    return [ax + (bx - ax) * f, ay + (by - ay) * f];
  };
}

/**
 * Whether the writing hand covers a point: its palm, 85 mm around the heel, its forearm (70 mm either side of the line
 * from the tip through the heel, as the pen's lean varies by 15 degrees), and 25 mm around the tip.
 */
export function handCovers(hand: 'right' | 'left', grip: Grip, tip: Vec2, p: Vec2): boolean {
  const sx = hand === 'left' ? -1 : 1;
  const heel: Vec2 = grip === 'hooked' ? [tip[0] + sx * 38, tip[1] - 36] : [tip[0] + sx * 42, tip[1] + 48];
  const ax = heel[0] - tip[0];
  const ay = heel[1] - tip[1];
  const n = Math.hypot(ax, ay);
  const ex = p[0] - heel[0];
  const ey = p[1] - heel[1];
  const along = (ex * ax + ey * ay) / n;
  const across = Math.abs(ex * ay - ey * ax) / n;
  return Math.hypot(ex, ey) < 85 || (along > 0 && across < 70) || Math.hypot(p[0] - tip[0], p[1] - tip[1]) < 25;
}

/**
 * Where a finger of the other hand lands: anywhere on the screen the writing hand does not cover, at least `room` mm
 * from every edge, with room for `below` mm more under it.
 */
export function otherHand(r: Rand, hand: 'right' | 'left', grip: Grip, tip: Vec2, screen: Vec2, below = 0): Vec2 {
  const room = 15;
  for (let k = 0; k < 400; k++) {
    const p: Vec2 = [between(r, room, screen[0] - room), between(r, room, screen[1] - room - below)];
    if (!handCovers(hand, grip, tip, p) && !handCovers(hand, grip, tip, [p[0], p[1] + below])) return p;
  }
  return [hand === 'left' ? screen[0] - room : room, room];
}
