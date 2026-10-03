// A seeded model of a writing hand and of handwriting. The pen plan writes words along lines, hovering between words
// and leaving range between lines. The hand places palm heel, pinky, and knuckle contacts relative to the pen tip by
// handedness and grip, with physical sizes, growth after landing, and splitting into several contacts. Every
// non-intent contact it makes has at least one physical tell a page can see: where it is, how big it is, or how it
// moves with the pen.

import type { Grip } from './session';
import type { Rand, SessionWriter, Vec2 } from './writer';
import { between } from './writer';

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
}

export function palmShape(r: Rand, grows = false): PalmShape {
  return {
    major: between(r, 35, 60),
    minor: between(r, 25, 40),
    initial: grows ? between(r, 7, 11) : between(r, 20, 30),
    growMs: grows ? between(r, 30, 300) : between(r, 0, 80),
  };
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
}

/**
 * A resting palm that follows the pen: it slides with the writing hand and stays planted while the pen hovers.
 * Returns the contact ids.
 */
export function palm(w: SessionWriter, r: Rand, o: PalmOptions): number[] {
  const shape = palmShape(r, o.grows);
  const ids: number[] = [];
  const mirror = o.offset[0] < 0 ? -1 : 1;
  const parts = Math.max(1, Math.min(3, o.parts ?? 1));
  for (let k = 0; k < parts; k++) {
    const part = PALM_PARTS[k];
    const t0 = o.t0 + (k === 0 ? 0 : between(r, 0, o.spread ?? 150));
    const at = (t: number): Vec2 => {
      const [px, py] = o.follow(t);
      return [px + o.offset[0] + part.dx * mirror, py + o.offset[1] + part.dy];
    };
    const id = w.touch({
      t0,
      t1: o.t1,
      at,
      size: (t) => sizeAt(shape, t0, t, part.scale),
      cls: k === 2 ? 'wrist' : 'palm',
      intent: 'none',
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

/** A finger of the other hand: a far-side contact that moves along a path. */
export function farSide(hand: 'right' | 'left', from: Vec2, distance: number): Vec2 {
  return [from[0] + (hand === 'left' ? distance : -distance), from[1] - distance * 0.4];
}
