// The geometric optics tool's pictures: the three principal rays through a thin lens or off a mirror, the light at a
// flat face, rays traced through a train of elements, and a Gaussian beam's width along its axis.
import type { Plot, PlotLabel, PlotSeries, Tone } from '../kit/types';
import type { Element, Matrix } from './engine';

type Point = [number, number];
type Line = (x: number) => Point;

/** The straight line through two points. */
const through =
  (p: Point, q: Point): Line =>
  (x) => [x, p[1] + ((q[1] - p[1]) / (q[0] - p[0])) * (x - p[0])];

const span = (series: readonly PlotSeries[]): [number, number] => {
  const xs = series.flatMap((one) => one.points.map(([x]) => x));
  return [Math.min(...xs), Math.max(...xs)];
};

/**
 * The principal rays for an object of height h a distance s in front of a thin lens of focal length f, with its image
 * at si. A mirror is the same picture with everything after the element folded back to its left.
 */
export function principalRays(f: number, s: number, h: number, si: number, mirror: boolean): Plot {
  const hi = (-si / s) * h;
  const reach = Math.max(s, 2 * Math.abs(f));
  // Light after the element runs a little past the image, or past the focal points when the image is far away.
  const far = Math.min(Math.max(Math.abs(si), 2 * Math.abs(f), s) * 1.15, 4 * reach);
  const flip = (points: Point[]): Point[] => (mirror ? points.map(([x, y]): Point => [-x, y]) : points);
  const object: Point = [-s, h];
  const y3 = (-h * f) / (s - f);
  // Parallel to the axis then through the rear focal point; through the center (the vertex of a mirror) undeviated;
  // and through the front focal point then parallel, left out when it would leave the picture.
  const rays: { at: Point; out: Line }[] = [
    { at: [0, h], out: through([0, h], [f, 0]) },
    { at: [0, 0], out: through(object, [0, 0]) },
  ];
  if (Math.abs(y3) <= 4 * Math.max(Math.abs(h), Math.abs(hi))) rays.push({ at: [0, y3], out: (x) => [x, y3] });
  const tones: Tone[] = ['accent', 'second', 'third'];
  const series: PlotSeries[] = [];
  rays.forEach((ray, i) => {
    series.push(
      { points: [object, ray.at], tone: tones[i] },
      { points: flip([ray.out(0), ray.out(far)]), tone: tones[i] },
    );
    // A virtual image: the rays seem to come from it, drawn dashed back from the element.
    if (si < 0) series.push({ points: flip([ray.out(0), ray.out(si)]), tone: tones[i], dash: true });
  });
  const tall = 1.25 * Math.max(Math.abs(h), Math.abs(hi), ...rays.map((ray) => Math.abs(ray.at[1])));
  const [imageX] = flip([[si, 0]])[0];
  const [focalX] = flip([[f, 0]])[0];
  if (si < 0)
    series.push({
      points: [
        [imageX, 0],
        [imageX, hi],
      ],
      tone: 'danger',
      dash: true,
      width: 2,
    });
  const [x0, x1] = span(series);
  series.unshift({
    points: [
      [Math.min(x0, -1.1 * reach), 0],
      [Math.max(x1, 0.1 * reach), 0],
    ],
    tone: 'muted',
  });
  series.push({
    points: [
      [0, -tall],
      [0, tall],
    ],
    tone: 'ink',
    width: 3,
  });
  const marks: { x: number; text: string }[] = mirror
    ? [
        { x: focalX, text: 'F' },
        { x: -2 * f, text: 'C' },
      ]
    : [
        { x: f, text: 'F′' },
        { x: -f, text: 'F' },
      ];
  const labels: PlotLabel[] = marks.map((mark) => ({
    x: mark.x,
    y: -0.12 * tall,
    text: mark.text,
    anchor: 'middle',
    tone: 'muted',
  }));
  return {
    frame: 'sketch',
    alt: {
      key: mirror ? 'kitPhysics.geooptics.plot.mirror' : 'kitPhysics.geooptics.plot.lens',
      labels: { kind: si > 0 ? 'kitPhysics.geooptics.kind.real' : 'kitPhysics.geooptics.kind.virtual' },
    },
    x: { label: '' },
    y: { label: '' },
    series,
    circles: marks.map((mark) => ({ x: mark.x, y: 0, r: 3, px: true, tone: 'muted' as const, fill: true })),
    labels,
    arrows: [
      { x1: -s, y1: 0, x2: -s, y2: h, tone: 'ink' },
      ...(si > 0 ? [{ x1: imageX, y1: 0, x2: imageX, y2: hi, tone: 'danger' as const }] : []),
    ],
    legend: [
      { tone: 'ink', key: 'kitPhysics.geooptics.legend.object' },
      { tone: 'danger', key: 'kitPhysics.geooptics.legend.image', dash: si < 0 },
    ],
  };
}

/** Incident, reflected, and refracted rays at a flat face between n1 (above) and n2 (below). */
export function interfaceSketch(theta1: number, theta2: number | null): Plot {
  const sin1 = Math.sin(theta1);
  const cos1 = Math.cos(theta1);
  const series: PlotSeries[] = [
    {
      points: [
        [-1.2, 0],
        [1.2, 0],
      ],
      tone: 'ink',
      width: 2,
    },
    {
      points: [
        [0, -1.05],
        [0, 1.05],
      ],
      tone: 'muted',
      dash: true,
    },
    {
      points: [
        [-sin1, cos1],
        [0, 0],
      ],
      tone: 'accent',
      width: 2,
    },
    {
      points: [
        [0, 0],
        [sin1, cos1],
      ],
      tone: 'second',
      width: theta2 === null ? 2 : 1,
    },
  ];
  if (theta2 !== null)
    series.push({
      points: [
        [0, 0],
        [Math.sin(theta2), -Math.cos(theta2)],
      ],
      tone: 'third',
      width: 2,
    });
  return {
    frame: 'sketch',
    alt: { key: theta2 === null ? 'kitPhysics.geooptics.plot.tir' : 'kitPhysics.geooptics.plot.refraction' },
    x: { label: '', min: -1.2, max: 1.2 },
    y: { label: '', min: -1.1, max: 1.1 },
    series,
    labels: [
      { x: -1.15, y: 0.1, text: 'n₁', anchor: 'start' },
      { x: -1.15, y: -0.16, text: 'n₂', anchor: 'start' },
    ],
    legend: [
      { tone: 'accent', key: 'kitPhysics.geooptics.legend.incident' },
      { tone: 'second', key: 'kitPhysics.geooptics.legend.reflected' },
      ...(theta2 === null ? [] : [{ tone: 'third' as const, key: 'kitPhysics.geooptics.legend.refracted' as const }]),
    ],
  };
}

/**
 * A ray through a train of elements, unfolded: it starts at height y0 and angle a0 a distance s in front of the first
 * element, and runs `after` past the last. Returns its (axial position, height) at each element.
 */
export function traceRay(
  elements: readonly Element[],
  each: readonly Matrix[],
  y0: number,
  a0: number,
  s: number,
  after: number,
): Point[] {
  let [y, a] = [y0 + s * a0, a0];
  let z = 0;
  const points: Point[] = [
    [-s, y0],
    [0, y],
  ];
  elements.forEach((element, i) => {
    const m = each[i];
    [y, a] = [m[0] * y + m[1] * a, m[2] * y + m[3] * a];
    if (element.kind === 'gap') {
      z += element.d;
      points.push([z, y]);
    }
  });
  points.push([z + after, y + after * a]);
  return points;
}

/** A Gaussian beam's 1/e² radius from z0 to z1 about a waist w0 at zw: the upper edge, then the lower. */
export function beamEnvelope(w0: number, zR: number, zw: number, z0: number, z1: number): [Point[], Point[]] {
  const top: Point[] = [];
  for (let i = 0; i <= 160; i++) {
    const z = z0 + ((z1 - z0) * i) / 160;
    const r = (z - zw) / zR;
    top.push([z, w0 * Math.sqrt(1 + r * r)]);
  }
  return [top, top.map(([z, w]): Point => [z, -w])];
}
