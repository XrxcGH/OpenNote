// The other kinds of line a graph block plots besides y = f(x):
//
// - A parametric curve in t, over the block's @t range (0 to 2π unless it says): `(cos t, sin 2t)`.
// - A polar curve: `r = 1 + cos θ`. Typing `theta` or `t` for θ works too.
// - A vector field, drawn as arrows on a grid: `F = (-y, x)`.
// - A slope field, drawn as short dashes: `dy/dx = x - y`.
//
// Each is sampled into the same segments a function becomes, so print, export, and the screen draw them alike.
import { compileMulti, greekWords, multiParameters, type MultiExpression } from '../space/multivar';
import type { ExpressionProblem, Params } from './evaluate';
import { findParameters } from './parser';
import type { Pixel, Segment, Size, Viewport } from './types';
import { toPixel } from './viewport';

export type CurveKind =
  | { readonly kind: 'function' }
  | { readonly kind: 'parametric'; readonly x: string; readonly y: string }
  | { readonly kind: 'polar'; readonly r: string }
  | { readonly kind: 'field'; readonly p: string; readonly q: string }
  | { readonly kind: 'slope'; readonly f: string };

/** The parameter range of parametric and polar curves when the block gives none. */
export const DEFAULT_T: readonly [number, number] = [0, 2 * Math.PI];

/** The parts of "(a, b)" split at its top-level commas, or null when the text is not one bracketed tuple. */
export function splitTuple(text: string): string[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null;
  const parts: string[] = [];
  let depth = 0;
  let start = 1;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') {
      depth--;
      // The first bracket closes before the end, as in (a)(b): not one tuple.
      if (depth === 0 && i !== trimmed.length - 1) return null;
    } else if (c === ',' && depth === 1) {
      parts.push(trimmed.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(trimmed.slice(start, -1));
  return parts.length >= 2 ? parts.map((part) => part.trim()) : null;
}

const FIELD_HEAD = /^\s*(?:F|G|V|field)\s*(?:\(\s*x\s*,\s*y\s*\))?\s*=?\s*(?=\()/;
const SLOPE_HEAD = /^\s*(?:dy\s*\/\s*dx|y')\s*=(.*)$/;
const POLAR_HEAD = /^\s*r\s*(?:\(\s*(?:θ|theta|t)\s*\))?\s*=(?!=)(.*)$/;
const PARAMETRIC_HEAD = /^\s*(?:[A-Za-z]\s*\(\s*t\s*\)\s*=)?\s*(?=\()/;

/** What kind of line this is. Anything that is not one of the others is a function of x. */
export function classifyLine(line: string): CurveKind {
  const slope = SLOPE_HEAD.exec(line);
  if (slope) return { kind: 'slope', f: slope[1].trim() };
  const polar = POLAR_HEAD.exec(line);
  if (polar) return { kind: 'polar', r: polar[1].trim() };
  const field = FIELD_HEAD.exec(line);
  if (field) {
    const parts = splitTuple(line.slice(field[0].length));
    if (parts?.length === 2) return { kind: 'field', p: parts[0], q: parts[1] };
  }
  const parametric = PARAMETRIC_HEAD.exec(line);
  if (parametric) {
    const parts = splitTuple(line.slice(parametric[0].length));
    if (parts?.length === 2) return { kind: 'parametric', x: parts[0], y: parts[1] };
  }
  return { kind: 'function' };
}

/** The variables each kind is written in. */
function variablesOf(kind: CurveKind): string[] {
  switch (kind.kind) {
    case 'parametric':
      return ['t'];
    case 'polar':
      return ['θ', 't'];
    case 'field':
    case 'slope':
      return ['x', 'y'];
    default:
      return ['x'];
  }
}

/** The texts a kind is made of, such as the x(t) and y(t) of a parametric curve. */
function partsOf(kind: CurveKind): string[] {
  switch (kind.kind) {
    case 'parametric':
      return [kind.x, kind.y];
    case 'polar':
      return [kind.r];
    case 'field':
      return [kind.p, kind.q];
    case 'slope':
      return [kind.f];
    default:
      return [];
  }
}

/** True for a line the grapher's y = f(x) path does not draw. */
export const isSpecialLine = (line: string): boolean => classifyLine(line).kind !== 'function';

/** The letters a special line uses that need a slider: not its own variables, constants, or functions. */
export function specialParameters(line: string): string[] {
  const kind = classifyLine(line);
  const found: string[] = [];
  for (const part of partsOf(kind)) {
    for (const name of multiParameters(part, variablesOf(kind))) if (!found.includes(name)) found.push(name);
  }
  return found;
}

/** The letters any graph line uses that need a slider. A line that cannot be read has none until it is fixed. */
export function lineParameters(line: string): string[] {
  try {
    return isSpecialLine(line) ? specialParameters(line) : findParameters(line);
  } catch {
    return [];
  }
}

/** The compiled parts of a special line, or the first problem. */
export function compileSpecial(
  line: string,
  params: Params,
): { ok: true; kind: CurveKind; parts: MultiExpression[] } | { ok: false; error: ExpressionProblem } {
  const kind = classifyLine(line);
  const parts: MultiExpression[] = [];
  const offset = (part: string) => Math.max(0, greekWords(line).indexOf(greekWords(part)));
  for (const part of partsOf(kind)) {
    const read = compileMulti(part, variablesOf(kind), Object.keys(params));
    if (!read.ok) return { ok: false, error: { ...read.error, position: read.error.position + offset(part) } };
    parts.push(read.expression);
  }
  return { ok: true, kind, parts };
}

/** The point of a parametric or polar curve at `t`, or null when it is not defined there. */
export function curvePoint(kind: CurveKind, parts: readonly MultiExpression[], t: number, params: Params) {
  const values = { ...params, t, θ: t };
  let x: number;
  let y: number;
  if (kind.kind === 'parametric') {
    x = parts[0].evaluate(values);
    y = parts[1].evaluate(values);
  } else if (kind.kind === 'polar') {
    const r = parts[0].evaluate(values);
    x = r * Math.cos(t);
    y = r * Math.sin(t);
  } else return null;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Samples a parametric or polar curve over [t0, t1]. A jump of more than half the view breaks the line. */
export function sampleCurve(
  kind: CurveKind,
  parts: readonly MultiExpression[],
  range: readonly [number, number],
  view: Viewport,
  params: Params,
  count = 720,
): Segment[] {
  const segments: Segment[] = [];
  let run: { x: number; y: number }[] = [];
  const jump = Math.max(view.xMax - view.xMin, view.yMax - view.yMin) / 2;
  for (let i = 0; i <= count; i++) {
    const t = range[0] + ((range[1] - range[0]) * i) / count;
    const point = curvePoint(kind, parts, t, params);
    const last = run[run.length - 1];
    if (!point || (last && Math.hypot(point.x - last.x, point.y - last.y) > jump)) {
      if (run.length > 1) segments.push(run);
      run = point ? [point] : [];
      continue;
    }
    run.push(point);
  }
  if (run.length > 1) segments.push(run);
  return segments;
}

const fmt = (value: number) => String(Number(value.toFixed(2)));

/**
 * Path data for a vector or slope field on a grid of about `cells` across. Arrows are scaled so the longest fits one
 * cell; slope dashes are all one length. Points where the field is not defined are left empty.
 */
export function fieldPath(
  kind: CurveKind,
  parts: readonly MultiExpression[],
  view: Viewport,
  size: Size,
  params: Params,
  cells = 20,
): string {
  if (kind.kind !== 'field' && kind.kind !== 'slope') return '';
  const step = size.width / cells;
  const rows = Math.max(1, Math.round(size.height / step));
  const samples: { at: Pixel; dx: number; dy: number }[] = [];
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < rows; j++) {
      const at = { x: (i + 0.5) * step, y: (j + 0.5) * (size.height / rows) };
      const x = view.xMin + (at.x / size.width) * (view.xMax - view.xMin);
      const y = view.yMax - (at.y / size.height) * (view.yMax - view.yMin);
      const values = { ...params, x, y };
      const p = kind.kind === 'field' ? parts[0].evaluate(values) : 1;
      const q = kind.kind === 'field' ? parts[1].evaluate(values) : parts[0].evaluate(values);
      if (!Number.isFinite(p) || !Number.isFinite(q)) continue;
      // From graph units to pixels: y flips, and the axes may have different scales.
      const dx = (p * size.width) / (view.xMax - view.xMin);
      const dy = (-q * size.height) / (view.yMax - view.yMin);
      samples.push({ at, dx, dy });
    }
  }
  const longest = Math.max(...samples.map((s) => Math.hypot(s.dx, s.dy)), 0);
  if (longest === 0) return '';
  let d = '';
  for (const { at, dx, dy } of samples) {
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const k = kind.kind === 'slope' ? (step * 0.7) / length : (step * 0.85) / longest;
    const [ux, uy] = [dx * k, dy * k];
    if (kind.kind === 'slope') {
      d += `M${fmt(at.x - ux / 2)} ${fmt(at.y - uy / 2)}L${fmt(at.x + ux / 2)} ${fmt(at.y + uy / 2)}`;
      continue;
    }
    const tip = { x: at.x + ux / 2, y: at.y + uy / 2 };
    d += `M${fmt(at.x - ux / 2)} ${fmt(at.y - uy / 2)}L${fmt(tip.x)} ${fmt(tip.y)}`;
    const head = Math.min(5, Math.hypot(ux, uy) * 0.4);
    const angle = Math.atan2(uy, ux);
    for (const side of [-1, 1]) {
      const a = angle + Math.PI - side * 0.45;
      d += `M${fmt(tip.x)} ${fmt(tip.y)}L${fmt(tip.x + head * Math.cos(a))} ${fmt(tip.y + head * Math.sin(a))}`;
    }
  }
  return d;
}

/** A point's place on the plot, for the trace dot. */
export const pointPixel = (view: Viewport, size: Size, point: { x: number; y: number }): Pixel =>
  toPixel(view, size, point);
