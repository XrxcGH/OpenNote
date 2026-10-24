// Districting measures. From 2-party results: the efficiency gap, the mean-median difference, and population
// deviation. From a district's outline: Polsby-Popper and Reock compactness.
import { fail } from '../core/util';

export interface District {
  name: string;
  a: number;
  b: number;
  population: number | null;
}

export interface Fairness {
  wastedA: number;
  wastedB: number;
  total: number;
  /** (wasted A - wasted B) / total: positive when A wastes more, so the map favors B. */
  gap: number;
  /** Mean minus median of A's vote share across districts. */
  meanMedian: number;
  seatsA: number;
  voteShareA: number;
  deviation: number | null;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Wasted votes: every vote for the loser, and the winner's votes beyond half of the district's votes. */
export function fairness(districts: readonly District[]): Fairness {
  if (districts.length === 0) fail('noDistricts');
  if (districts.some((d) => d.a < 0 || d.b < 0 || d.a + d.b === 0)) fail('districtVotes');
  let wastedA = 0;
  let wastedB = 0;
  let seatsA = 0;
  for (const d of districts) {
    const half = (d.a + d.b) / 2;
    if (d.a > d.b) {
      seatsA += 1;
      wastedA += d.a - half;
      wastedB += d.b;
    } else {
      wastedB += d.b - half;
      wastedA += d.a;
    }
  }
  const total = districts.reduce((s, d) => s + d.a + d.b, 0);
  const shares = districts.map((d) => d.a / (d.a + d.b));
  const pops = districts.map((d) => d.population);
  const deviation = pops.every((p): p is number => p !== null && p > 0)
    ? (Math.max(...pops) - Math.min(...pops)) / (pops.reduce((s, p) => s + p, 0) / pops.length)
    : null;
  return {
    wastedA,
    wastedB,
    total,
    gap: (wastedA - wastedB) / total,
    meanMedian: shares.reduce((s, x) => s + x, 0) / shares.length - median(shares),
    seatsA,
    voteShareA: districts.reduce((s, d) => s + d.a, 0) / total,
    deviation,
  };
}

export interface Point {
  x: number;
  y: number;
}

export function polygonArea(pts: readonly Point[]): number {
  let s = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  });
  return Math.abs(s) / 2;
}

export function perimeter(pts: readonly Point[]): number {
  return pts.reduce((s, p, i) => {
    const q = pts[(i + 1) % pts.length];
    return s + Math.hypot(q.x - p.x, q.y - p.y);
  }, 0);
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

const inside = (c: Circle, p: Point) => Math.hypot(p.x - c.x, p.y - c.y) <= c.r * (1 + 1e-12) + 1e-12;

function circleFrom(ps: readonly Point[]): Circle {
  if (ps.length === 1) return { ...ps[0], r: 0 };
  if (ps.length === 2)
    return {
      x: (ps[0].x + ps[1].x) / 2,
      y: (ps[0].y + ps[1].y) / 2,
      r: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) / 2,
    };
  const [a, b, c] = ps;
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) {
    // Collinear: the circle on the farthest pair.
    const pairs: [Point, Point][] = [
      [a, b],
      [a, c],
      [b, c],
    ];
    const far = pairs.reduce((m, p) =>
      Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) > Math.hypot(m[0].x - m[1].x, m[0].y - m[1].y) ? p : m,
    );
    return circleFrom(far);
  }
  const sq = (p: Point) => p.x * p.x + p.y * p.y;
  const x = (sq(a) * (b.y - c.y) + sq(b) * (c.y - a.y) + sq(c) * (a.y - b.y)) / d;
  const y = (sq(a) * (c.x - b.x) + sq(b) * (a.x - c.x) + sq(c) * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

/** The smallest circle around the points, by the incremental (Welzl) method. */
export function enclosingCircle(pts: readonly Point[]): Circle {
  let c: Circle = { ...pts[0], r: 0 };
  for (let i = 1; i < pts.length; i += 1) {
    if (inside(c, pts[i])) continue;
    c = { ...pts[i], r: 0 };
    for (let j = 0; j < i; j += 1) {
      if (inside(c, pts[j])) continue;
      c = circleFrom([pts[i], pts[j]]);
      for (let k = 0; k < j; k += 1) if (!inside(c, pts[k])) c = circleFrom([pts[i], pts[j], pts[k]]);
    }
  }
  return c;
}

export function compactness(pts: readonly Point[]): {
  area: number;
  perimeter: number;
  polsbyPopper: number;
  reock: number;
  circle: Circle;
} {
  if (pts.length < 3) fail('polygonPoints');
  const area = polygonArea(pts);
  if (area === 0) fail('polygonFlat');
  const p = perimeter(pts);
  const circle = enclosingCircle(pts);
  return {
    area,
    perimeter: p,
    polsbyPopper: (4 * Math.PI * area) / (p * p),
    reock: area / (Math.PI * circle.r * circle.r),
    circle,
  };
}
