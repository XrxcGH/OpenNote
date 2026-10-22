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
import type { Viewport } from '../grapher';
import { readNumber } from '../space/vec';

export interface GraphSource {
  /** The lines that are functions, in order. */
  functions: string[];
  params: Record<string, number>;
  view: Viewport | null;
  /** The range of t for parametric and polar curves, when the text gives one. */
  t?: readonly [number, number] | null;
}

const T_RANGE = /^@t\s+(\S+)\s+(\S+)\s*$/;
const VIEW = /^@view\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/;
const PARAM = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*$/i;
// `r = 2` is a polar circle, not a slider.
const RESERVED = new Set(['x', 'y', 'f', 'r']);

export function readGraph(text: string): GraphSource {
  const out: GraphSource = { functions: [], params: {}, view: null, t: null };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const range = T_RANGE.exec(line);
    if (range) {
      const [from, to] = [readNumber(range[1]), readNumber(range[2])];
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
    const param = PARAM.exec(line);
    if (param && !RESERVED.has(param[1])) {
      out.params[param[1]] = Number(param[2]);
      continue;
    }
    out.functions.push(line);
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
  if (graph.t) lines.push(`@t ${round(graph.t[0])} ${round(graph.t[1])}`);
  return lines.join('\n');
}
