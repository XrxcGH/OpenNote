// The hand of the hand-drawn corpus: how a pen moves through what the hand means to draw, and how a digitizer
// samples it.

import type { Vec } from '../../types';
import { dist, gauss, lerp, uniform, type Intent, type Rand } from './intent';

export interface TimedPoint {
  readonly x: number;
  readonly y: number;
  readonly time: number;
}

/** How the stroke ends: the pen held still to ask for a shape, or lifted at once (ink-to-shape on every stroke). */
export type Ending = 'hold' | 'lift';

/** Moves each corner a little off where it was meant, as a hand places it: about 2% of the size. */
function placed(r: Rand, intent: Intent, size: number, care: number): Vec[] {
  if (!intent.corners) return intent.points;
  const moved = intent.points.map((p) => ({
    x: p.x + gauss(r) * 0.018 * care * size,
    y: p.y + gauss(r) * 0.018 * care * size,
  }));
  if (intent.closed) moved[moved.length - 1] = moved[0];
  return moved;
}

/** One corner as the pen turns it: sharp, rounded, or hooked past the corner and back. */
function corner(r: Rand, prev: Vec, at: Vec, next: Vec, size: number, care: number): Vec[] {
  const style = r();
  if (style < 0.35) return [at];
  const inLength = dist(prev, at);
  const outLength = dist(at, next);
  if (style < 0.8) {
    const radius = Math.min(uniform(r, 0.015, 0.06) * care * size, 0.3 * inLength, 0.3 * outLength);
    const a = lerp(at, prev, radius / inLength);
    const b = lerp(at, next, radius / outLength);
    return Array.from({ length: 9 }, (_, k) => {
      const t = k / 8;
      return lerp(lerp(a, at, t), lerp(at, b, t), t);
    });
  }
  // The pen runs past a corner by its momentum, which a short side never builds up.
  const past = Math.min(uniform(r, 0.01, 0.035) * care * size, 0.15 * inLength, 0.15 * outLength);
  return [lerp(at, prev, -past / inLength), lerp(at, next, (0.4 * past) / outLength)];
}

/** The pen's path through the placed intent: corners turned by the hand and sides that bow, every half unit. */
function traced(r: Rand, intent: Intent, size: number, care: number): Vec[] {
  const pts = placed(r, intent, size, care);
  if (!intent.corners) return resampleBy(pts, 0.5);
  const turned: Vec[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) turned.push(...corner(r, pts[i - 1], pts[i], pts[i + 1], size, care));
  turned.push(pts[pts.length - 1]);
  // Sides bow: each straight run between corners swings out by up to about 1.5% of its length.
  const out: Vec[] = [];
  for (let i = 1; i < turned.length; i++) {
    const a = turned[i - 1];
    const b = turned[i];
    const length = dist(a, b);
    const bow = length > 0.1 * size ? gauss(r) * 0.012 * care * length : 0;
    const n = Math.max(1, Math.ceil(length / 0.5));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const p = lerp(a, b, t);
      const swing = bow * Math.sin(Math.PI * t);
      out.push({ x: p.x - ((b.y - a.y) / length) * swing, y: p.y + ((b.x - a.x) / length) * swing });
    }
  }
  return out;
}

function resampleBy(points: readonly Vec[], step: number): Vec[] {
  const out: Vec[] = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = dist(a, b);
    let d = step - carry;
    while (d <= length) {
      out.push(lerp(a, b, d / length));
      d += step;
    }
    carry = length - (d - step);
  }
  if (dist(out[out.length - 1], points[points.length - 1]) > 1e-9) out.push(points[points.length - 1]);
  return out;
}

/** A closed stroke's end: it stops a little short of its start, or runs on past it, drifting off to one side. */
function closing(r: Rand, path: Vec[], size: number, shape: boolean, care: number): Vec[] {
  const total = path.length * 0.5;
  const share = shape ? uniform(r, -0.03 * care, 0.08 * care) : 0;
  const off = gauss(r) * 0.015 * care * size;
  if (share < 0) return path.slice(0, Math.max(2, path.length - Math.round((-share * total) / 0.5)));
  const extra = path.slice(1, 1 + Math.round((share * total) / 0.5));
  return [
    ...path,
    ...extra.map((p, k) => {
      const t = (k + 1) / extra.length;
      const a = path[Math.min(path.length - 1, k + 1)];
      const b = path[Math.min(path.length - 1, k + 2)];
      const length = dist(a, b) || 1;
      return { x: p.x - ((b.y - a.y) / length) * off * t, y: p.y + ((b.x - a.x) / length) * off * t };
    }),
  ];
}

/** A short tail where the pen lands a little off the start, or flicks off the end as it lifts. */
function tail(r: Rand, from: Vec, size: number): Vec[] {
  const a = uniform(r, 0, 2 * Math.PI);
  const length = uniform(r, 0.01, 0.035) * size;
  return resampleBy([from, { x: from.x + length * Math.cos(a), y: from.y + length * Math.sin(a) }], 0.5);
}

/**
 * When the pen passes each point of the path. It moves fast on straight runs and slows into turns, by the two-thirds
 * power law (speed goes as the cube root of the radius of the turn), within what a hand can speed up and slow down.
 */
function timing(r: Rand, path: readonly Vec[], size: number): number[] {
  const top = uniform(r, 350, 1500);
  const reach = 0.25 * size;
  const n = path.length;
  const speed = path.map((p, i) => {
    const a = path[Math.max(0, i - 4)];
    const b = path[Math.min(n - 1, i + 4)];
    const turn = Math.abs(
      Math.atan2(
        (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x),
        (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y),
      ),
    );
    const bend = turn / Math.max(0.5, dist(a, p) + dist(p, b));
    return Math.min(top, top * Math.cbrt(1 / Math.max(1e-6, bend * reach)));
  });
  // A hand speeds up and slows down at most about 15,000 units a second squared, from rest at both ends.
  const accel = 15000;
  speed[0] = 20;
  for (let i = 1; i < n; i++)
    speed[i] = Math.min(speed[i], Math.sqrt(speed[i - 1] ** 2 + 2 * accel * dist(path[i - 1], path[i])));
  speed[n - 1] = Math.min(speed[n - 1], 20);
  for (let i = n - 2; i >= 0; i--)
    speed[i] = Math.min(speed[i], Math.sqrt(speed[i + 1] ** 2 + 2 * accel * dist(path[i], path[i + 1])));
  const times = [0];
  for (let i = 1; i < n; i++)
    times.push(times[i - 1] + (2 * dist(path[i - 1], path[i])) / Math.max(20, speed[i - 1] + speed[i]));
  return times;
}

/** The digitizer's samples: the pen's place every 1/hz seconds, with sensor noise and a slow drift of the hand. */
function sampled(
  r: Rand,
  path: readonly Vec[],
  times: readonly number[],
  size: number,
  hz: number,
  care: number,
): TimedPoint[] {
  const noise = uniform(r, 0.08, 0.35);
  const drift = uniform(r, 0, 0.01) * care * size;
  const [fx, fy] = [uniform(r, 1.5, 4.5), uniform(r, 1.5, 4.5)];
  const [px, py] = [uniform(r, 0, 6.3), uniform(r, 0, 6.3)];
  const out: TimedPoint[] = [];
  const end = times[times.length - 1];
  let j = 0;
  for (let t = 0; t <= end + 1e-9; t += 1 / hz) {
    while (j < times.length - 2 && times[j + 1] < t) j++;
    const span = times[j + 1] - times[j];
    const p = lerp(path[j], path[j + 1], span > 0 ? Math.min(1, (t - times[j]) / span) : 0);
    out.push({
      x: p.x + gauss(r) * noise + drift * Math.sin(2 * Math.PI * fx * t + px),
      y: p.y + gauss(r) * noise + drift * Math.sin(2 * Math.PI * fy * t + py),
      time: t * 1000,
    });
  }
  const last = path[path.length - 1];
  if (out.length === 0 || dist(out[out.length - 1], last) > 0.25) out.push({ ...last, time: end * 1000 });
  return out;
}

/** The pen held still at the end: it trembles a fraction of a unit for a third to half a second. */
function held(r: Rand, points: TimedPoint[], hz: number): TimedPoint[] {
  const last = points[points.length - 1];
  const count = Math.round(uniform(r, 0.3, 0.5) * hz);
  const still = Array.from({ length: count }, (_, k) => ({
    x: last.x + gauss(r) * 0.15,
    y: last.y + gauss(r) * 0.15,
    time: last.time + ((k + 1) * 1000) / hz,
  }));
  return [...points, ...still];
}
export /** One drawing of an intent by the hand, at `hz`, placed on the page and ended by `ending`. */
function draw(
  r: Rand,
  intent: Intent,
  size: number,
  hz: number,
  ending: Ending,
  shape: boolean,
  care: number,
): TimedPoint[] {
  let path = traced(r, intent, size, care);
  if (intent.closed) path = closing(r, path, size, shape, care);
  if (r() < 0.25) path = [...tail(r, path[0], size).reverse(), ...path.slice(1)];
  if (ending === 'lift' && r() < 0.25) path = [...path, ...tail(r, path[path.length - 1], size).slice(1)];
  const times = timing(r, path, size);
  const at = { x: uniform(r, 200, 800), y: uniform(r, 200, 800) };
  const points = sampled(r, path, times, size, hz, care).map((p) => ({ ...p, x: p.x + at.x, y: p.y + at.y }));
  return ending === 'hold' ? held(r, points, hz) : points;
}
