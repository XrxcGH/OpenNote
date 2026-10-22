// A graph lives in a fenced code block whose language is "graph" (Phase 10). Its text is the whole graph, so it
// saves, undoes, copies, and exports as text, and a reader without graphs sees the functions it plots:
//
//   y = sin(a x)
//   y = x^2 / 4
//   a = 2
//   @view -10 10 -6 6
//
// A line "name = number" gives a slider's value. "@view" is the part of the plane in view. "@t 0 2pi" is the range
// of t (or θ) for parametric and polar curves. Every other line is a function of x, or one of the kinds in
// grapher/curves.ts: (x(t), y(t)), r = f(θ), F = (P, Q), or dy/dx = f(x, y).
//
// A 3D graph is the same block: a line such as "z = sin(x) cos(y)" or "(cos(t), sin(t), t/5)" makes it 3D, and so
// does "@3d". There "@view" is the x and y the surface covers, "@camera" is the turn, tilt (both in degrees), and
// zoom it is seen from, and "@range t 0 12" sets how far t, u, or v runs.
import type { Viewport } from '../grapher';
import { isPlot3d } from '../grapher3d/plot';
import type { Range } from '../grapher3d/plot';
import type { Camera } from '../grapher3d/scene';
import { readNumber } from '../space/vec';

export type RangeLetter = 't' | 'u' | 'v';

export interface GraphSource {
  /** The lines that are functions, in order. */
  functions: string[];
  params: Record<string, number>;
  view: Viewport | null;
  /** True for a 3D graph. */
  three?: boolean;
  camera?: Camera | null;
  ranges?: Partial<Record<RangeLetter, Range>>;
  /** The range of t for parametric and polar curves, when the text gives one. */
  t?: readonly [number, number] | null;
}

const T_RANGE = /^@t\s+(\S+)\s+(\S+)\s*$/;
const VIEW = /^@view\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/;
const PARAM = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*$/i;
// `r = 2` is a polar circle, not a slider.
const RESERVED = new Set(['x', 'y', 'z', 'f', 'r']);
const CAMERA = /^@camera\s+(\S+)\s+(\S+)\s+(\S+)\s*$/;
const RANGE = /^@range\s+([tuv])\s+(\S+)\s+(\S+)\s*$/;
const RADIANS = Math.PI / 180;

export function readGraph(text: string): GraphSource {
  const out: GraphSource = { functions: [], params: {}, view: null, t: null };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const tRange = T_RANGE.exec(line);
    if (tRange) {
      const [from, to] = [readNumber(tRange[1]), readNumber(tRange[2])];
      if (Number.isFinite(from) && Number.isFinite(to) && from < to) out.t = [from, to];
      continue;
    }
    const view = VIEW.exec(line);
    if (view) {
      const [xMin, xMax, yMin, yMax] = view.slice(1).map(Number);
      if ([xMin, xMax, yMin, yMax].every(Number.isFinite) && xMin < xMax && yMin < yMax) {
        out.view = { xMin, xMax, yMin, yMax };
      }
      continue;
    }
    if (line === '@3d') {
      out.three = true;
      continue;
    }
    const camera = CAMERA.exec(line);
    if (camera) {
      const [yaw, pitch, zoom] = camera.slice(1).map(Number);
      if ([yaw, pitch, zoom].every(Number.isFinite) && zoom > 0) {
        out.camera = { yaw: yaw * RADIANS, pitch: Math.max(-89, Math.min(89, pitch)) * RADIANS, zoom };
      }
      continue;
    }
    const range = RANGE.exec(line);
    if (range) {
      const [min, max] = [Number(range[2]), Number(range[3])];
      if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
        out.ranges = { ...out.ranges, [range[1] as RangeLetter]: { min, max } };
      }
      continue;
    }
    const param = PARAM.exec(line);
    if (param && !RESERVED.has(param[1])) {
      out.params[param[1]] = Number(param[2]);
      continue;
    }
    out.functions.push(line);
    if (isPlot3d(line)) out.three = true;
  }
  return out;
}

const round = (value: number) => String(Number(value.toPrecision(6)));

/** The text for a graph: functions, then parameter values, then the view. */
export function writeGraph(graph: GraphSource): string {
  const lines = [...graph.functions];
  for (const [name, value] of Object.entries(graph.params)) lines.push(`${name} = ${round(value)}`);
  if (graph.view) {
    const { xMin, xMax, yMin, yMax } = graph.view;
    lines.push(`@view ${round(xMin)} ${round(xMax)} ${round(yMin)} ${round(yMax)}`);
  }
  // "@3d" is written only when no line says so by itself, such as a new 3D graph with no functions yet.
  if (graph.three && !graph.functions.some(isPlot3d)) lines.push('@3d');
  if (graph.three && graph.camera) {
    const { yaw, pitch, zoom } = graph.camera;
    lines.push(`@camera ${round(yaw / RADIANS)} ${round(pitch / RADIANS)} ${round(zoom)}`);
  }
  for (const [letter, range] of Object.entries(graph.ranges ?? {})) {
    if (range) lines.push(`@range ${letter} ${round(range.min)} ${round(range.max)}`);
  }
  if (graph.t) lines.push(`@t ${round(graph.t[0])} ${round(graph.t[1])}`);
  return lines.join('\n');
}
