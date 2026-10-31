// The Skew-T log-P diagram: pressure on a log scale upward, isotherms leaning 45 degrees to the right, with dry
// adiabats, pseudo-adiabats, and saturation mixing-ratio lines behind the sounding, its parcel path, and wind barbs;
// and a hodograph of the winds with the storm motions.
import type { Figure, Mark } from '../core/figure';
import { pathOf } from '../core/figure';
import { linePlot } from '../core/plot';
import type { Level, Parcel } from './sounding';
import { EPS, KAPPA, T0, moistAdiabat } from './thermo';

const W = 380;
const H = 440;
const LEFT = 40;
const TOP = 12;
const P_BOTTOM = 105000;
const P_TOP = 10000;
const T_MIN = -40;
const T_MAX = 50;
const SPAN = Math.log(P_BOTTOM / P_TOP);
const PX_PER_C = (W - LEFT - 40) / (T_MAX - T_MIN);
const PX_PER_LN = (H - TOP - 30) / SPAN;
const SKEW = PX_PER_LN / PX_PER_C;

const y = (p: number) => TOP + (H - TOP - 30) - Math.log(P_BOTTOM / p) * PX_PER_LN;
const x = (t: number, p: number) => LEFT + (t - T0 - T_MIN + SKEW * Math.log(P_BOTTOM / p)) * PX_PER_C;

const PRESSURES = Array.from({ length: 48 }, (_, k) => P_BOTTOM * (P_TOP / P_BOTTOM) ** (k / 47));

function inside(points: [number, number][]): [number, number][] {
  return points.map(([px, py]) => (px >= LEFT && px <= W - 40 ? [px, py] : [Number.NaN, Number.NaN]));
}

function background(): Mark[] {
  const marks: Mark[] = [];
  for (const p of [100000, 85000, 70000, 50000, 30000, 20000, 10000]) {
    marks.push({ kind: 'line', x1: LEFT, y1: y(p), x2: W - 40, y2: y(p), role: 'grid' });
    marks.push({
      kind: 'text',
      x: LEFT - 4,
      y: y(p) + 4,
      text: String(p / 100),
      role: 'muted',
      size: 9,
      anchor: 'end',
    });
  }
  for (let c = -110; c <= 50; c += 10) {
    const pts = inside(PRESSURES.map((p): [number, number] => [x(c + T0, p), y(p)]));
    marks.push({ kind: 'path', d: pathOf(pts), role: 'grid', width: c === 0 ? 1.2 : 0.7 });
    const bx = x(c + T0, P_BOTTOM);
    if (bx >= LEFT && bx <= W - 40)
      marks.push({ kind: 'text', x: bx, y: H - 16, text: String(c), role: 'muted', size: 9, anchor: 'middle' });
  }
  for (let theta = 250; theta <= 450; theta += 10) {
    const pts = inside(PRESSURES.map((p): [number, number] => [x(theta * (p / 1e5) ** KAPPA, p), y(p)]));
    marks.push({ kind: 'path', d: pathOf(pts), role: 's1', width: 0.6, opacity: 0.6 });
  }
  for (let c = -10; c <= 35; c += 5) {
    const pts = inside(
      PRESSURES.filter((p) => p <= 100000).map((p): [number, number] => [x(moistAdiabat(c + T0, 1e5, p), p), y(p)]),
    );
    marks.push({ kind: 'path', d: pathOf(pts), role: 's2', width: 0.6, dash: true });
  }
  for (const w of [1, 2, 4, 8, 16, 32]) {
    const pts = PRESSURES.filter((p) => p >= 40000).map((p): [number, number] => {
      // The temperature where the saturation mixing ratio equals w g/kg: invert Bolton's form.
      const e = ((w / 1000) * p) / (EPS + w / 1000);
      const l = Math.log(e / 611.2);
      return [x(T0 + (243.5 * l) / (17.67 - l), p), y(p)];
    });
    marks.push({ kind: 'path', d: pathOf(inside(pts)), role: 's4', width: 0.6, dash: true });
    const [tx, ty] = pts[pts.length - 1];
    if (tx >= LEFT && tx <= W - 40)
      marks.push({ kind: 'text', x: tx, y: ty - 3, text: String(w), role: 'muted', size: 8, anchor: 'middle' });
  }
  marks.push({ kind: 'rect', x: LEFT, y: TOP, w: W - 40 - LEFT, h: H - TOP - 30, role: 'axis' });
  return marks;
}

function barb(px: number, py: number, u: number, v: number): Mark[] {
  const speed = Math.hypot(u, v) * 1.943844;
  if (speed < 2.5) return [{ kind: 'circle', cx: px, cy: py, r: 3, role: 'text' }];
  // The staff points toward where the wind comes from.
  const dir = [-u / Math.hypot(u, v), v / Math.hypot(u, v)];
  const side = [-dir[1], dir[0]];
  const marks: Mark[] = [
    { kind: 'line', x1: px, y1: py, x2: px + dir[0] * 26, y2: py + dir[1] * 26, role: 'text', width: 1 },
  ];
  let left = Math.round(speed / 5) * 5;
  let d = 26;
  while (left >= 50) {
    const a = [px + dir[0] * d, py + dir[1] * d];
    const b = [px + dir[0] * (d - 6), py + dir[1] * (d - 6)];
    const tip = `${(a[0] + side[0] * 10).toFixed(1)} ${(a[1] + side[1] * 10).toFixed(1)}`;
    marks.push({
      kind: 'path',
      d: `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${tip}L${b[0].toFixed(1)} ${b[1].toFixed(1)}Z`,
      role: 'text',
      fill: true,
    });
    left -= 50;
    d -= 8;
  }
  while (left >= 5) {
    const long = left >= 10 ? 10 : 5;
    const a = [px + dir[0] * d, py + dir[1] * d];
    marks.push({
      kind: 'line',
      x1: a[0],
      y1: a[1],
      x2: a[0] + side[0] * long + dir[0] * 3,
      y2: a[1] + side[1] * long + dir[1] * 3,
      role: 'text',
      width: 1,
    });
    left -= long === 10 ? 10 : 5;
    d -= 4;
  }
  return marks;
}

export interface SkewText {
  title: string;
  description: string;
  pressure: string;
  temperature: string;
}

/** The sounding on a Skew-T: temperature, dew point, the parcel path, and barbs on the right edge. */
export function skewT(levels: readonly Level[], parcel: Parcel | null, words: SkewText): Figure {
  const marks = background();
  const line = (get: (l: Level) => number) =>
    inside(levels.filter((l) => l.p >= P_TOP).map((l): [number, number] => [x(get(l), l.p), y(l.p)]));
  marks.push({ kind: 'path', d: pathOf(line((l) => l.t)), role: 's3', width: 2.2 });
  marks.push({ kind: 'path', d: pathOf(line((l) => l.td)), role: 's0', width: 2.2 });
  if (parcel) {
    const pts = inside(parcel.path.filter(([p]) => p >= P_TOP).map(([p, t]): [number, number] => [x(t, p), y(p)]));
    marks.push({ kind: 'path', d: pathOf(pts), role: 'text', width: 1.4, dash: true });
    marks.push({
      kind: 'line',
      x1: x(parcel.lcl.t, parcel.lcl.p) - 6,
      y1: y(parcel.lcl.p),
      x2: x(parcel.lcl.t, parcel.lcl.p) + 6,
      y2: y(parcel.lcl.p),
      role: 'text',
      width: 2,
    });
  }
  for (const l of levels)
    if (l.u !== null && l.v !== null && l.p >= P_TOP) marks.push(...barb(W + 4, y(l.p), l.u, l.v));
  marks.push({
    kind: 'text',
    x: 10,
    y: (TOP + H - 30) / 2,
    text: words.pressure,
    role: 'text',
    size: 10,
    anchor: 'middle',
    rotate: -90,
  });
  marks.push({
    kind: 'text',
    x: (LEFT + W - 40) / 2,
    y: H - 2,
    text: words.temperature,
    role: 'text',
    size: 10,
    anchor: 'middle',
  });
  return { width: W + 34, height: H, title: words.title, description: words.description, marks };
}

/** The hodograph: the wind's tip from the ground up, with the Bunkers storm motions as dots. */
export function hodograph(
  levels: readonly Level[],
  storms: readonly { at: [number, number]; label: string }[],
  words: { title: string; description: string; u: string; v: string },
): Figure {
  const points = levels.filter((l) => l.u !== null && l.v !== null).map((l): [number, number] => [l.u!, l.v!]);
  const size =
    Math.max(
      10,
      ...points.flatMap(([u, v]) => [Math.abs(u), Math.abs(v)]),
      ...storms.flatMap((s) => s.at.map(Math.abs)),
    ) * 1.1;
  return linePlot({
    title: words.title,
    description: words.description,
    xLabel: words.u,
    yLabel: words.v,
    x: [-size, size],
    y: [-size, size],
    width: 300,
    height: 300,
    series: [
      { points, role: 's0' },
      { points, role: 's0', dots: true },
      ...storms.map((s, i) => ({ points: [s.at], dots: true, role: (i ? 's2' : 's1') as 's1', label: s.label })),
    ],
    vlines: [{ x: 0 }],
    hlines: [{ y: 0 }],
  });
}
