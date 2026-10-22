// A 3D graph is a graph code block whose first line is "@3d". Its text is the whole graph, so it saves, undoes,
// copies, and exports as text, and a reader without graphs still sees what it plots. Its lines:
//
// - A surface: `z = x^2 - y^2`. A curve in space over the @t range: `(cos t, sin t, t/4)`.
// - An arrow: `vector <1, 2, 3> at (0, 0, 1)`. Without "at" it starts at the origin.
// - A point: `point (1, -2, 4)`.
// - A line: `line (1, -2, 4) + t<1, 3, -1>`, or through two points: `line (1, 0, 0) to (0, 1, 2)`.
// - A plane: `plane 3x + 2y + 6z = 5`. A slider's value: `a = 2`.
// - The box: `@range -2 2 -2 2` for x and y, and `@zrange -4 4` for z.
// - The tangent plane to the first surface at x = 1, y = 0.5: `@tangent 1 0.5`.
// - What shows: `@show both` (surface, contour, or both). The turn, tilt, and zoom: `@angle -55 25 1`.
// - A solid of revolution: `@revolve sqrt(x); 0; 0; 4; y=0` (outer curve, inner curve, from, to, and axis).
import { lineThrough, readPlane, type Line3, type Plane } from './geometry3d';
import { splitTuple } from '../grapher/curves';
import { readNumber, readVec, type Vec3 } from './vec';

export type SpaceShow = 'surface' | 'contour' | 'both';

export interface Camera {
  /** The turn about the z axis, in degrees. */
  readonly azimuth: number;
  /** The tilt above the xy-plane, in degrees. */
  readonly elevation: number;
  readonly zoom: number;
}

export const DEFAULT_CAMERA: Camera = { azimuth: -55, elevation: 25, zoom: 1 };

export interface RevolveSpec {
  readonly outer: string;
  readonly inner: string;
  readonly from: number;
  readonly to: number;
  /** Turning about y = k (horizontal) or x = k (vertical). */
  readonly axis: { readonly kind: 'y' | 'x'; readonly at: number };
}

export interface SpaceSource {
  /** Surfaces, curves, vectors, points, lines, and planes, as typed. */
  items: string[];
  params: Record<string, number>;
  range: readonly [number, number, number, number] | null;
  zRange: readonly [number, number] | null;
  t: readonly [number, number] | null;
  tangent: readonly [number, number] | null;
  show: SpaceShow;
  camera: Camera | null;
  revolve: RevolveSpec | null;
}

export type SpaceItem =
  | { readonly kind: 'surface'; readonly source: string }
  | { readonly kind: 'curve'; readonly parts: readonly [string, string, string] }
  | { readonly kind: 'vector'; readonly head: Vec3; readonly tail: Vec3 }
  | { readonly kind: 'point'; readonly at: Vec3 }
  | { readonly kind: 'line'; readonly line: Line3 }
  | { readonly kind: 'plane'; readonly plane: Plane }
  | { readonly kind: 'invalid'; readonly message: 'vector' | 'point' | 'line' | 'plane' };

const ORIGIN: Vec3 = [0, 0, 0];

/** True when a graph block's text is a 3D graph. */
export const is3dGraph = (text: string): boolean => /^\s*@3d\b/.test(text);

/** What one item line is. Anything that is not a keyword or a tuple of three is a surface z = f(x, y). */
export function readItem(line: string): SpaceItem {
  const text = line.trim();
  const keyword = /^(vector|point|line|plane)\b\s*(.*)$/i.exec(text);
  if (keyword) {
    const word = keyword[1].toLowerCase() as 'vector' | 'point' | 'line' | 'plane';
    const rest = keyword[2];
    const invalid = { kind: 'invalid', message: word } as const;
    if (word === 'vector') {
      const [head, tail] = rest.split(/\s+(?:at|from)\s+/i);
      const h = readVec(head ?? '');
      const tl = tail === undefined ? ORIGIN : readVec(tail);
      return h && tl ? { kind: 'vector', head: h, tail: tl } : invalid;
    }
    if (word === 'point') {
      const at = readVec(rest);
      return at ? { kind: 'point', at } : invalid;
    }
    if (word === 'line') {
      const through = /^(.+?)\s+to\s+(.+)$/i.exec(rest);
      if (through) {
        const [a, b] = [readVec(through[1]), readVec(through[2])];
        return a && b ? { kind: 'line', line: lineThrough(a, b) } : invalid;
      }
      const vector = /^(.+?)\s*\+\s*t\s*\*?\s*(.+)$/.exec(rest);
      const [a, u] = vector ? [readVec(vector[1]), readVec(vector[2])] : [null, null];
      return a && u && (u[0] || u[1] || u[2]) ? { kind: 'line', line: { point: a, direction: u } } : invalid;
    }
    const plane = readPlane(rest);
    return plane ? { kind: 'plane', plane } : invalid;
  }
  const parts = splitTuple(text);
  if (parts?.length === 3) return { kind: 'curve', parts: [parts[0], parts[1], parts[2]] };
  return { kind: 'surface', source: text };
}

const PARAM = /^([A-Za-z])\s*=\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*$/i;
const RESERVED = new Set(['x', 'y', 'z', 't']);

function numbers(rest: string, count: number): number[] | null {
  const values = rest.trim().split(/\s+/).map(readNumber);
  return values.length >= count && values.slice(0, count).every(Number.isFinite) ? values : null;
}

function readRevolve(rest: string): RevolveSpec | null {
  const parts = rest.split(';').map((part) => part.trim());
  if (parts.length !== 5) return null;
  const [outer, inner, a, b, axisText] = parts;
  const from = readNumber(a);
  const to = readNumber(b);
  // "x-axis" is the line y = 0, and "y-axis" the line x = 0.
  const named = /^([xy])-axis$/i.exec(axisText);
  const axis = named
    ? [axisText, named[1].toLowerCase() === 'x' ? 'y' : 'x', '0']
    : /^([xy])\s*=\s*(.+)$/i.exec(axisText);
  if (!axis || !Number.isFinite(from) || !Number.isFinite(to) || from >= to || outer === '') return null;
  const at = readNumber(axis[2]);
  if (!Number.isFinite(at)) return null;
  const kind = axis[1].toLowerCase() as 'x' | 'y';
  return { outer, inner: inner === '' ? '0' : inner, from, to, axis: { kind, at } };
}

export function readSpace(text: string): SpaceSource {
  const out: SpaceSource = {
    items: [],
    params: {},
    range: null,
    zRange: null,
    t: null,
    tangent: null,
    show: 'surface',
    camera: null,
    revolve: null,
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || /^@3d\b/.test(line)) continue;
    const directive = /^@(\w+)\s*(.*)$/.exec(line);
    if (directive) {
      const [, name, rest] = directive;
      if (name === 'range') {
        const v = numbers(rest, 4);
        if (v && v[0] < v[1] && v[2] < v[3]) out.range = [v[0], v[1], v[2], v[3]];
      } else if (name === 'zrange') {
        const v = numbers(rest, 2);
        if (v && v[0] < v[1]) out.zRange = [v[0], v[1]];
      } else if (name === 't') {
        const v = numbers(rest, 2);
        if (v && v[0] < v[1]) out.t = [v[0], v[1]];
      } else if (name === 'tangent') {
        const v = numbers(rest, 2);
        if (v) out.tangent = [v[0], v[1]];
      } else if (name === 'show') {
        const show = rest.trim().toLowerCase();
        if (show === 'surface' || show === 'contour' || show === 'both') out.show = show;
      } else if (name === 'angle') {
        const v = numbers(rest, 2);
        if (v) out.camera = { azimuth: v[0], elevation: v[1], zoom: Number.isFinite(v[2]) && v[2] > 0 ? v[2] : 1 };
      } else if (name === 'revolve') {
        out.revolve = readRevolve(rest);
      }
      continue;
    }
    const param = PARAM.exec(line);
    if (param && !RESERVED.has(param[1])) {
      out.params[param[1]] = Number(param[2]);
      continue;
    }
    out.items.push(line);
  }
  return out;
}

const round = (value: number) => String(Number(value.toPrecision(6)));

export function writeSpace(space: SpaceSource): string {
  const lines = ['@3d', ...space.items];
  for (const [name, value] of Object.entries(space.params)) lines.push(`${name} = ${round(value)}`);
  if (space.range) lines.push(`@range ${space.range.map(round).join(' ')}`);
  if (space.zRange) lines.push(`@zrange ${space.zRange.map(round).join(' ')}`);
  if (space.t) lines.push(`@t ${space.t.map(round).join(' ')}`);
  if (space.tangent) lines.push(`@tangent ${space.tangent.map(round).join(' ')}`);
  if (space.show !== 'surface') lines.push(`@show ${space.show}`);
  if (space.revolve) {
    const { outer, inner, from, to, axis } = space.revolve;
    lines.push(`@revolve ${outer}; ${inner}; ${round(from)}; ${round(to)}; ${axis.kind}=${round(axis.at)}`);
  }
  if (space.camera) {
    const { azimuth, elevation, zoom } = space.camera;
    lines.push(`@angle ${round(azimuth)} ${round(elevation)}${zoom === 1 ? '' : ` ${round(zoom)}`}`);
  }
  return lines.join('\n');
}
