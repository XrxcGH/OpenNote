// Turns 3D samples into a flat picture: the box the plot sits in, its axes, a shaded face per surface cell, and a path
// per curve. They are all in pixels, painted back to front. The camera turns around the vertical axis (yaw) and tilts
// (pitch). `sceneToSvg3d` writes the same picture as a standalone SVG for export and print, where it stays vector.
import type { Size } from '../grapher';
import type { Point3, Sampled } from './plot';

export interface Camera {
  /** Turn around the z axis, in radians. */
  readonly yaw: number;
  /** Tilt toward looking down, in radians, between -pi/2 and pi/2. */
  readonly pitch: number;
  /** 1 fits the box in the view. */
  readonly zoom: number;
}

export const DEFAULT_CAMERA: Camera = { yaw: (-35 * Math.PI) / 180, pitch: (25 * Math.PI) / 180, zoom: 1 };
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;
const LIMIT = Math.PI / 2 - 0.01;

/** The camera after a turn and a tilt (radians), kept upright and in range. */
export function rotateCamera(camera: Camera, yaw: number, pitch: number): Camera {
  const turned = camera.yaw + yaw;
  const wrapped = Math.atan2(Math.sin(turned), Math.cos(turned));
  return { ...camera, yaw: wrapped, pitch: Math.max(-LIMIT, Math.min(LIMIT, camera.pitch + pitch)) };
}

export function zoomCamera(camera: Camera, factor: number): Camera {
  return { ...camera, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor)) };
}

/** The extent of the plot on each axis, from the domain and the finite samples. */
export interface Bounds {
  readonly x: readonly [number, number];
  readonly y: readonly [number, number];
  readonly z: readonly [number, number];
}

const finite = (p: Point3) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/** The value at fraction `q` of the sorted values. */
const quantile = (sorted: readonly number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

function spread(values: number[], trim: boolean): [number, number] {
  if (values.length === 0) return [-1, 1];
  values.sort((a, b) => a - b);
  // A surface with a pole, such as 1/(x y), would flatten everything else, so its tallest few points are cut off.
  let low = trim ? quantile(values, 0.02) : values[0];
  let high = trim ? quantile(values, 0.98) : values[values.length - 1];
  if (!(high > low)) {
    low -= 1;
    high += 1;
  }
  return [low, high];
}

/** The box that holds the samples. A surface's x and y come from its domain, the rest from the points. */
export function boundsOf(
  plots: readonly Sampled[],
  domain?: { xMin: number; xMax: number; yMin: number; yMax: number },
) {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  let trimZ = false;
  for (const plot of plots) {
    if (plot.kind === 'surface') trimZ = true;
    for (const row of plot.rows) {
      for (const p of row) {
        if (!finite(p)) continue;
        xs.push(p.x);
        ys.push(p.y);
        zs.push(p.z);
      }
    }
  }
  const onlySurfaces = plots.length > 0 && plots.every((plot) => plot.kind === 'surface');
  const bounds: Bounds = {
    x: onlySurfaces && domain ? [domain.xMin, domain.xMax] : spread(xs, false),
    y: onlySurfaces && domain ? [domain.yMin, domain.yMax] : spread(ys, false),
    z: spread(zs, trimZ),
  };
  return bounds;
}

/** A point in the unit cube, -1 to 1 on each axis. */
type Unit = readonly [number, number, number];

function toUnit(p: Point3, b: Bounds): Unit {
  const scale = (v: number, [lo, hi]: readonly [number, number]) => ((v - lo) / (hi - lo)) * 2 - 1;
  return [scale(p.x, b.x), scale(p.y, b.y), scale(p.z, b.z) * 0.8];
}

/** A unit point on screen: its pixel and how near the viewer it is (larger is nearer). */
interface Projected {
  readonly px: number;
  readonly py: number;
  readonly depth: number;
}

export function projector(camera: Camera, size: Size): (u: Unit) => Projected {
  const [cy, sy] = [Math.cos(camera.yaw), Math.sin(camera.yaw)];
  const [cp, sp] = [Math.cos(camera.pitch), Math.sin(camera.pitch)];
  const scale = Math.min(size.width, size.height) * 0.3 * camera.zoom;
  return ([x, y, z]) => {
    const x1 = x * cy - y * sy;
    const y1 = x * sy + y * cy;
    const v = z * cp + y1 * sp;
    const depth = -y1 * cp + z * sp;
    return { px: size.width / 2 + x1 * scale, py: size.height / 2 - v * scale, depth };
  };
}

export interface Face {
  /** SVG points, in pixels. */
  readonly points: string;
  /** Which plot it belongs to, for its color. */
  readonly plot: number;
  /** 0 to 1: how much light it catches. */
  readonly light: number;
  readonly depth: number;
}

export interface Line3 {
  readonly d: string;
  readonly kind: 'box' | 'axis' | 'curve';
  readonly plot: number;
}

export interface Label3 {
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

export interface Scene3d {
  readonly size: Size;
  readonly bounds: Bounds;
  readonly faces: readonly Face[];
  readonly lines: readonly Line3[];
  readonly labels: readonly Label3[];
  readonly errors: readonly Sampled['error'][];
}

const round = (v: number) => Math.round(v * 10) / 10;
const pair = (p: Projected) => `${round(p.px)},${round(p.py)}`;
export const tickText = (value: number) => String(Number(value.toPrecision(3)));

/** Light falls from up and to the left of the viewer. */
const LIGHT: Unit = (() => {
  const v = [-0.4, -0.5, 0.77];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n] as const;
})();

function surfaceFaces(plot: Sampled, index: number, b: Bounds, project: (u: Unit) => Projected): Face[] {
  const faces: Face[] = [];
  const [zLo, zHi] = b.z;
  const reach = (zHi - zLo) * 0.5;
  const keep = (p: Point3) => finite(p) && p.z >= zLo - reach && p.z <= zHi + reach;
  const clampZ = (p: Point3): Point3 => ({ ...p, z: Math.max(zLo, Math.min(zHi, p.z)) });
  for (let j = 0; j + 1 < plot.rows.length; j += 1) {
    const [top, bottom] = [plot.rows[j], plot.rows[j + 1]];
    for (let i = 0; i + 1 < top.length; i += 1) {
      const corners = [top[i], top[i + 1], bottom[i + 1], bottom[i]];
      if (!corners.every(keep)) continue;
      const unit = corners.map((p) => toUnit(clampZ(p), b));
      // The normal of the cell from its two diagonals, which works for a cell that is not flat.
      const [a, c] = [unit[2].map((v, k) => v - unit[0][k]), unit[3].map((v, k) => v - unit[1][k])];
      const n = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
      const length = Math.hypot(...n) || 1;
      const light = Math.abs((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / length);
      const shown = unit.map(project);
      const depth = shown.reduce((sum, p) => sum + p.depth, 0) / 4;
      faces.push({ points: shown.map(pair).join(' '), plot: index, light, depth });
    }
  }
  return faces;
}

function curvePath(plot: Sampled, b: Bounds, project: (u: Unit) => Projected): string {
  let d = '';
  let pen = false;
  for (const p of plot.rows[0] ?? []) {
    if (!finite(p)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${pair(project(toUnit(p, b)))}`;
    pen = true;
  }
  return d;
}

/** The corners of the box, as unit points. */
const CORNER = (x: number, y: number, z: number): Unit => [x, y, z * 0.8];

function boxAndAxes(b: Bounds, project: (u: Unit) => Projected): { lines: Line3[]; labels: Label3[] } {
  const lines: Line3[] = [];
  const segment = (from: Unit, to: Unit, kind: Line3['kind']) =>
    lines.push({ d: `M${pair(project(from))}L${pair(project(to))}`, kind, plot: -1 });
  // The floor of the box, and its uprights at the four corners.
  const floor = [CORNER(-1, -1, -1), CORNER(1, -1, -1), CORNER(1, 1, -1), CORNER(-1, 1, -1)];
  floor.forEach((corner, i) => segment(corner, floor[(i + 1) % 4], 'box'));
  for (const [x, y] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const)
    segment(CORNER(x, y, -1), CORNER(x, y, 1), 'box');
  // The three axes along the box's edges from the corner nearest the origin of the numbers.
  segment(CORNER(-1, -1, -1), CORNER(1, -1, -1), 'axis');
  segment(CORNER(-1, -1, -1), CORNER(-1, 1, -1), 'axis');
  segment(CORNER(-1, -1, -1), CORNER(-1, -1, 1), 'axis');
  const at = (u: Unit, text: string, dx = 0, dy = 0): Label3 => {
    const p = project(u);
    return { x: round(p.px + dx), y: round(p.py + dy), text };
  };
  const labels = [
    at(CORNER(1.18, -1, -1), 'x'),
    at(CORNER(-1, 1.18, -1), 'y'),
    at(CORNER(-1, -1, 1.18), 'z'),
    at(CORNER(1, -1.12, -1), tickText(b.x[1])),
    at(CORNER(-1, 1, -1), tickText(b.y[1]), 4, 12),
    at(CORNER(-1.08, -1.08, 1), tickText(b.z[1]), -4),
    at(CORNER(-1.08, -1.08, -1), tickText(b.z[0]), -4, 12),
  ];
  return { lines, labels };
}

/** The picture of the samples from this camera. One plot that failed leaves its error and draws nothing. */
export function buildScene3d(plots: readonly Sampled[], camera: Camera, size: Size, bounds?: Bounds): Scene3d {
  const b = bounds ?? boundsOf(plots);
  const project = projector(camera, size);
  const faces: Face[] = [];
  const lines: Line3[] = [];
  plots.forEach((plot, index) => {
    if (plot.error) return;
    if (plot.kind === 'curve') lines.push({ d: curvePath(plot, b, project), kind: 'curve', plot: index });
    else faces.push(...surfaceFaces(plot, index, b, project));
  });
  faces.sort((a, c) => a.depth - c.depth);
  const frame = boxAndAxes(b, project);
  return {
    size,
    bounds: b,
    faces,
    lines: [...frame.lines, ...lines],
    labels: frame.labels,
    errors: plots.map((plot) => plot.error),
  };
}

/** How a face is drawn: more light, more color. */
export const faceOpacity = (light: number) => Math.round((0.45 + 0.5 * light) * 100) / 100;

export interface Svg3dStyle {
  readonly paper: string;
  readonly box: string;
  readonly axis: string;
  readonly text: string;
  readonly curves: readonly string[];
  readonly fontFamily: string;
  readonly labelSize: number;
  readonly title: string;
  readonly description: string;
}

const FACE_STROKE = 'stroke-width="0.5" stroke-opacity="0.6"';

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The scene as a standalone SVG document. */
export function sceneToSvg3d(scene: Scene3d, style: Svg3dStyle): string {
  const { width, height } = scene.size;
  const color = (plot: number) => style.curves[plot % style.curves.length] ?? style.axis;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"` +
      ' role="img" aria-labelledby="g3t g3d">',
    `<title id="g3t">${escape(style.title)}</title>`,
    `<desc id="g3d">${escape(style.description)}</desc>`,
    `<rect width="${width}" height="${height}" fill="${escape(style.paper)}"/>`,
  ];
  for (const line of scene.lines.filter((l) => l.kind !== 'curve')) {
    const stroke = line.kind === 'axis' ? style.axis : style.box;
    out.push(`<path d="${line.d}" fill="none" stroke="${escape(stroke)}" stroke-width="1"/>`);
  }
  for (const face of scene.faces) {
    const fill = `fill="${escape(color(face.plot))}" fill-opacity="${faceOpacity(face.light)}"`;
    out.push(`<polygon points="${face.points}" ${fill} stroke="${escape(style.paper)}" ${FACE_STROKE}/>`);
  }
  for (const line of scene.lines.filter((l) => l.kind === 'curve')) {
    out.push(`<path d="${line.d}" fill="none" stroke="${escape(color(line.plot))}" stroke-width="2.5"/>`);
  }
  for (const label of scene.labels) {
    const font = `font-family="${escape(style.fontFamily)}" font-size="${style.labelSize}"`;
    const at = `x="${label.x}" y="${label.y}" fill="${escape(style.text)}"`;
    out.push(`<text ${at} ${font} text-anchor="middle">${escape(label.text)}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}
