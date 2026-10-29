// Projects a World (world.ts) through a camera into flat drawing marks, back to front, so the nearest face is drawn
// last and covers what is behind it. The same marks become React SVG on screen and a standalone SVG for export, so
// the picture saved is the picture shown. Colors come from a Paint, which the screen gives as theme variables and
// the export as fixed colors.
import type { Pixel, Size } from '../grapher/types';
import type { Camera } from './source3d';
import { sub, type Vec3 } from './vec';
import type { Box3, Role, World } from './world';

export interface Projector {
  (p: Vec3): { x: number; y: number; depth: number };
}

/** An orthographic view of the box: turned about z by the azimuth, then tilted down by the elevation. */
export function projector(box: Box3, camera: Camera, size: Size): Projector {
  const center = box.min.map((v, k) => (v + box.max[k]) / 2);
  const half = box.min.map((v, k) => (box.max[k] - v) / 2 || 1);
  const az = (camera.azimuth * Math.PI) / 180;
  const el = (camera.elevation * Math.PI) / 180;
  const [ca, sa, ce, se] = [Math.cos(az), Math.sin(az), Math.cos(el), Math.sin(el)];
  const s = Math.min(size.width, size.height) * 0.3 * camera.zoom;
  return (p) => {
    // Each axis fills [-1, 1], with a surface's z a little flatter, so every graph fits the same cube.
    const flatten = box.equal ? 1 : 0.8;
    const [x, y, z] = [
      (p[0] - center[0]) / half[0],
      (p[1] - center[1]) / half[1],
      (flatten * (p[2] - center[2])) / half[2],
    ];
    const u = x * ca - y * sa;
    const v = x * sa + y * ca;
    return { x: size.width / 2 + s * u, y: size.height / 2 - s * (v * se + z * ce), depth: -v * ce + z * se };
  };
}

export type Mark =
  | { kind: 'face'; points: Pixel[]; depth: number; role: Role; series: number; tone: number; light: number }
  | { kind: 'line'; points: Pixel[]; depth: number; role: Role | 'box' | 'axis'; series: number; tone?: number }
  | { kind: 'arrow'; from: Pixel; to: Pixel; depth: number; series: number }
  | { kind: 'dot'; at: Pixel; depth: number; series: number; role: 'point' | 'tangent' }
  | { kind: 'text'; at: Pixel; depth: number; text: string; anchor: 'start' | 'middle' | 'end' };

const fmt = (value: number) => String(Number(value.toPrecision(3)));

/** Every mark, farthest first. Lines and dots sit a little in front of the faces they lie on. */
export function projectWorld(world: World, camera: Camera, size: Size): Mark[] {
  const project = projector(world.box, camera, size);
  const marks: Mark[] = [];
  const flat = (p: Vec3) => {
    const q = project(p);
    return { x: q.x, y: q.y };
  };
  const depthOf = (points: readonly Vec3[]) => points.reduce((sum, p) => sum + project(p).depth, 0) / points.length;
  for (const face of world.faces) {
    marks.push({ kind: 'face', ...face, points: face.points.map(flat), depth: depthOf(face.points) });
  }
  for (const line of world.lines) {
    // Each piece sorts on its own, so a curve can pass in front of a surface and then behind it.
    for (let k = 1; k < line.points.length; k++) {
      const pair = [line.points[k - 1], line.points[k]];
      marks.push({
        kind: 'line',
        points: pair.map(flat),
        depth: depthOf(pair) + 0.02,
        role: line.role,
        series: line.series,
        ...(line.tone === undefined ? {} : { tone: line.tone }),
      });
    }
  }
  for (const arrow of world.arrows) {
    marks.push({
      kind: 'arrow',
      from: flat(arrow.from),
      to: flat(arrow.to),
      depth: depthOf([arrow.from, arrow.to]) + 0.05,
      series: arrow.series,
    });
  }
  for (const dot of world.dots) {
    marks.push({
      kind: 'dot',
      at: flat(dot.at),
      depth: project(dot.at).depth + 0.1,
      series: dot.series,
      role: dot.role,
    });
  }
  marks.push(...frame(world.box, project));
  return marks.sort((a, b) => a.depth - b.depth);
}

/** The box's edges, the axes through the origin when it is inside, and the axis names and end values. */
function frame(box: Box3, project: Projector): Mark[] {
  const marks: Mark[] = [];
  const corner = (i: number): Vec3 => [
    i & 1 ? box.max[0] : box.min[0],
    i & 2 ? box.max[1] : box.min[1],
    i & 4 ? box.max[2] : box.min[2],
  ];
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue;
      const pair = [corner(i), corner(i | bit)];
      const points = pair.map((p) => project(p));
      // The box sits behind everything, so its edges never cover the graph.
      marks.push({ kind: 'line', points, depth: -1e6, role: 'box', series: 0 });
    }
  }
  const origin: Vec3 = [0, 0, 0];
  const holds = origin.every((v, k) => v >= box.min[k] && v <= box.max[k]);
  const names = ['x', 'y', 'z'];
  for (let k = 0; k < 3; k++) {
    const start = [...origin] as [number, number, number];
    const end = [...origin] as [number, number, number];
    start[k] = box.min[k];
    end[k] = box.max[k];
    if (holds) {
      const points = [project(start), project(end)];
      marks.push({ kind: 'line', points, depth: (points[0].depth + points[1].depth) / 2, role: 'axis', series: 0 });
    }
    // The name past the far end of the axis's edge of the box, and the two end values along it.
    const edge0: Vec3 = [box.min[0], box.min[1], box.min[2]];
    const edge1 = [...edge0] as [number, number, number];
    edge1[k] = box.max[k];
    const along = sub(edge1, edge0);
    const past: Vec3 = [edge1[0] + along[0] * 0.12, edge1[1] + along[1] * 0.12, edge1[2] + along[2] * 0.12];
    const at = project(past);
    marks.push({ kind: 'text', at, depth: 1e6, text: names[k], anchor: 'middle' });
    for (const [p, value] of [
      [edge0, box.min[k]],
      [edge1, box.max[k]],
    ] as const) {
      const q = project(p);
      marks.push({ kind: 'text', at: { x: q.x, y: q.y + 12 }, depth: 1e6, text: fmt(value), anchor: 'middle' });
    }
  }
  return dedupeLabels(marks);
}

/** The corner shared by the three edges gets one value per axis; two labels at one spot become one. */
function dedupeLabels(marks: Mark[]): Mark[] {
  const seen = new Set<string>();
  return marks.filter((mark) => {
    if (mark.kind !== 'text') return true;
    const key = `${Math.round(mark.at.x / 8)},${Math.round(mark.at.y / 8)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Colors for the marks. `tone` runs from low (0) to high (1); `light` from shadow (0) to full light (1). */
export interface Paint {
  face(role: Role, series: number, tone: number, light: number): string;
  faceOpacity(role: Role): number;
  stroke(role: Role | 'box' | 'axis', series: number, tone?: number): string;
  dot(role: 'point' | 'tangent', series: number): string;
  text: string;
  paper: string;
  fontFamily: string;
}

/** A mark as an SVG element: its tag and attributes in React's camelCase names, and its text if any. */
export interface Drawn {
  tag: 'polygon' | 'line' | 'path' | 'circle' | 'text';
  attrs: Record<string, string | number>;
  text?: string;
}

const p2 = (p: Pixel) => `${fmt2(p.x)},${fmt2(p.y)}`;
const fmt2 = (value: number) => String(Number(value.toFixed(2)));

const WIDTH: Partial<Record<string, number>> = {
  box: 0.75,
  axis: 1.25,
  contour: 1.25,
  curve: 2.5,
  line: 2,
  vector: 2.5,
};

export function drawMarks(marks: readonly Mark[], paint: Paint): Drawn[] {
  const out: Drawn[] = [];
  for (const mark of marks) {
    if (mark.kind === 'face') {
      const fill = paint.face(mark.role, mark.series, mark.tone, mark.light);
      const opacity = paint.faceOpacity(mark.role);
      out.push({
        tag: 'polygon',
        attrs: {
          points: mark.points.map(p2).join(' '),
          fill,
          fillOpacity: opacity,
          // A hairline of the same color closes the seams between solid faces. See-through faces have none, or
          // their overlapping edges would show as darker lines.
          ...(opacity === 1 ? { stroke: fill, strokeWidth: 0.6, strokeLinejoin: 'round' } : {}),
        },
      });
    } else if (mark.kind === 'line') {
      const [a, b] = mark.points;
      out.push({
        tag: 'line',
        attrs: {
          x1: fmt2(a.x),
          y1: fmt2(a.y),
          x2: fmt2(b.x),
          y2: fmt2(b.y),
          stroke: paint.stroke(mark.role, mark.series, mark.tone),
          strokeWidth: WIDTH[mark.role] ?? 2,
          strokeLinecap: 'round',
          ...(mark.role === 'box' ? { strokeDasharray: '3 3' } : {}),
        },
      });
    } else if (mark.kind === 'arrow') {
      const { from, to } = mark;
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const head = Math.min(12, Math.hypot(to.x - from.x, to.y - from.y) * 0.4);
      const side = (s: number) => ({
        x: to.x - head * Math.cos(angle - s * 0.4),
        y: to.y - head * Math.sin(angle - s * 0.4),
      });
      const stroke = paint.stroke('vector', mark.series);
      const at = (p: Pixel) => p2(p).replace(',', ' ');
      out.push({
        tag: 'path',
        attrs: {
          d: `M${at(from)}L${at(to)}M${at(side(1))}L${at(to)}L${at(side(-1))}`,
          stroke,
          fill: 'none',
          strokeWidth: WIDTH.vector!,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
      });
    } else if (mark.kind === 'dot') {
      out.push({
        tag: 'circle',
        attrs: {
          cx: fmt2(mark.at.x),
          cy: fmt2(mark.at.y),
          r: 4.5,
          fill: paint.dot(mark.role, mark.series),
          stroke: paint.paper,
          strokeWidth: 1.5,
        },
      });
    } else {
      out.push({
        tag: 'text',
        attrs: {
          x: fmt2(mark.at.x),
          y: fmt2(mark.at.y),
          textAnchor: mark.anchor,
          fill: paint.text,
          fontSize: 11,
          fontFamily: paint.fontFamily,
        },
        text: mark.text,
      });
    }
  }
  return out;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Drawn marks as a standalone SVG document string, with no scripts or outside references. */
export function drawnToSvg(
  drawn: readonly Drawn[],
  size: Size,
  paper: string,
  title: string,
  description = '',
): string {
  const body = drawn
    .map((mark) => {
      const attrs = Object.entries(mark.attrs)
        .map(([key, value]) => ` ${kebab(key)}="${escapeXml(String(value))}"`)
        .join('');
      return mark.text === undefined
        ? `<${mark.tag}${attrs}/>`
        : `<${mark.tag}${attrs}>${escapeXml(mark.text)}</${mark.tag}>`;
    })
    .join('');
  const desc = description === '' ? '' : `<desc>${escapeXml(description)}</desc>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.width} ${size.height}" width="${size.width}" ` +
    `height="${size.height}" role="img"><title>${escapeXml(title)}</title>${desc}` +
    `<rect width="${size.width}" height="${size.height}" fill="${escapeXml(paper)}"/>${body}</svg>`
  );
}
