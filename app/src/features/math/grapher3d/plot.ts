// What a line of a 3D graph means, and its points. Three kinds of line draw in 3D:
//
// - `z = sin(x) cos(y)` is a surface over the x-y plane. `f(x, y) = ...` works too.
// - `(cos(t), sin(t), t / 5)` is a curve, traced as t runs over its range.
// - `(cos(u) sin(v), sin(u) sin(v), cos(v))` is a surface traced by u and v.
//
// Each part is compiled by the grapher's engine (grapher/evaluate.ts), so the text is never run as code and a bad
// line can only give NaN, which leaves a gap. Nothing here touches the DOM.
import { freeNames } from '../../../core/expr';
import { compileExpression, findParameters } from '../grapher';
import { parseExpression } from '../grapher/parser';
import type { CompiledExpression, ExpressionProblem, Params } from '../grapher';

export type PlotKind = 'surface' | 'curve' | 'parametricSurface';

/** The letters that run along the axes or the parameters of a parametric line. They never get a slider. */
export const AXIS_LETTERS: ReadonlySet<string> = new Set(['x', 'y', 'z', 't', 'u', 'v']);

/** A range that t, u, or v runs over. */
export interface Range {
  readonly min: number;
  readonly max: number;
}

export const DEFAULT_RANGES: Readonly<Record<'t' | 'u' | 'v', Range>> = {
  t: { min: 0, max: 2 * Math.PI },
  u: { min: 0, max: 2 * Math.PI },
  v: { min: 0, max: Math.PI },
};

/** The part of the x-y plane a surface covers. */
export interface Domain {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

export const DEFAULT_DOMAIN: Domain = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A line read for 3D: its kind and the text of each part with any "z =" or "r(t) =" taken off. */
export interface PlotShape {
  readonly kind: PlotKind;
  readonly parts: readonly string[];
}

const SURFACE_HEAD = /^\s*(?:z|[A-Za-z]\w*\s*\(\s*x\s*,\s*y\s*\))\s*=(?!=)/;
const PARAMETRIC_HEAD = /^\s*(?:[A-Za-z]\w*\s*\(\s*[tuv](?:\s*,\s*[tuv])?\s*\)\s*=)?\s*/;

/** The parts of "(a, b, c)" split at its top-level commas, or null when the text is not one bracketed list. */
function tupleParts(text: string): string[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null;
  const inner = trimmed.slice(1, -1);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') {
      depth -= 1;
      if (depth < 0) return null;
    } else if (c === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) return null;
  parts.push(inner.slice(start));
  return parts.map((part) => part.trim());
}

const usesLetter = (part: string, letter: string): boolean => {
  try {
    return findParameters(part).includes(letter);
  } catch {
    return false;
  }
};

/** How a line draws in 3D, or null when it is a 2D line (such as y = x^2). */
export function plotShape(line: string): PlotShape | null {
  const head = SURFACE_HEAD.exec(line);
  if (head) return { kind: 'surface', parts: [line.slice(head[0].length).trim()] };
  const tuple = tupleParts(line.replace(PARAMETRIC_HEAD, ''));
  if (tuple && tuple.length === 3) {
    const surface = tuple.some((part) => usesLetter(part, 'u') || usesLetter(part, 'v'));
    return { kind: surface ? 'parametricSurface' : 'curve', parts: tuple };
  }
  // A bare expression in x and y, with or without spaces, is the surface z = that expression.
  if (!line.includes('=') && !tuple && usesXandY(line)) return { kind: 'surface', parts: [line.trim()] };
  return null;
}

/** True for a line that draws in 3D. */
export const isPlot3d = (line: string): boolean => plotShape(line) !== null;

/** True when the expression uses both x and y, so it reads as a surface (used to pick 2D or 3D for an equation). */
export function usesXandY(expression: string): boolean {
  try {
    const names = freeNames(parseExpression(expression, { parameters: findParameters(expression) }));
    return names.includes('x') && names.includes('y');
  } catch {
    return false;
  }
}

/** The letters a 3D line uses that need a slider: anything but the axes, t, u, and v. */
export function plotParameters(line: string): string[] {
  const shape = plotShape(line);
  if (!shape) return [];
  const found: string[] = [];
  for (const part of shape.parts) {
    try {
      for (const name of findParameters(part)) if (!AXIS_LETTERS.has(name) && !found.includes(name)) found.push(name);
    } catch {
      // A part that cannot be read shows its problem when it is compiled.
    }
  }
  return found;
}

/** The samples of one line. A surface is a grid of rows of points, and a curve is one row. NaN marks a gap. */
export interface Sampled {
  readonly kind: PlotKind;
  readonly source: string;
  readonly rows: readonly (readonly Point3[])[];
  readonly error: ExpressionProblem | null;
}

export interface SampleInput {
  readonly source: string;
  readonly params?: Params;
}

export interface SampleOptions {
  readonly domain?: Domain;
  readonly ranges?: Partial<Record<'t' | 'u' | 'v', Range>>;
  /** Grid cells along each side of a surface. Default 32. */
  readonly grid?: number;
  /** Steps along a curve. Default 240. */
  readonly steps?: number;
}

/** At most this many cells along a side, so a pasted number cannot stall the page. */
export const MAX_GRID = 96;

function compileAll(parts: readonly string[], letters: readonly string[], params: Params) {
  const parameters = [...letters, ...Object.keys(params)];
  const compiled: CompiledExpression[] = [];
  for (const part of parts) {
    const result = compileExpression(part, { parameters });
    if (!result.ok) return { ok: false as const, error: result.error };
    compiled.push(result.expression);
  }
  return { ok: true as const, compiled };
}

const lerp = (range: Range, i: number, n: number) => range.min + ((range.max - range.min) * i) / n;

/** Samples a line for 3D. One bad line comes back with its problem and no points; it never throws. */
export function samplePlot(input: SampleInput, options: SampleOptions = {}): Sampled {
  const shape = plotShape(input.source);
  const params = input.params ?? {};
  const empty = (error: ExpressionProblem | null): Sampled => ({
    kind: shape?.kind ?? 'surface',
    source: input.source,
    rows: [],
    error,
  });
  if (!shape) {
    return empty({ message: 'This line is not a 3D graph.', position: 0, length: Math.max(1, input.source.length) });
  }
  const n = Math.max(2, Math.min(MAX_GRID, Math.round(options.grid ?? 32)));
  const ranges = { ...DEFAULT_RANGES, ...options.ranges };
  if (shape.kind === 'surface') {
    const built = compileAll(shape.parts, ['y'], params);
    if (!built.ok) return empty(built.error);
    const [f] = built.compiled;
    const domain = options.domain ?? DEFAULT_DOMAIN;
    const rows: Point3[][] = [];
    for (let j = 0; j <= n; j += 1) {
      const y = lerp({ min: domain.yMin, max: domain.yMax }, j, n);
      const row: Point3[] = [];
      for (let i = 0; i <= n; i += 1) {
        const x = lerp({ min: domain.xMin, max: domain.xMax }, i, n);
        row.push({ x, y, z: f.evaluate(x, { ...params, y }) });
      }
      rows.push(row);
    }
    return { kind: 'surface', source: input.source, rows, error: null };
  }
  const letters = shape.kind === 'curve' ? ['t'] : ['u', 'v'];
  const built = compileAll(shape.parts, letters, params);
  if (!built.ok) return empty(built.error);
  const [fx, fy, fz] = built.compiled;
  const at = (values: Params): Point3 => ({
    x: fx.evaluate(0, values),
    y: fy.evaluate(0, values),
    z: fz.evaluate(0, values),
  });
  if (shape.kind === 'curve') {
    const steps = Math.max(8, Math.min(4000, Math.round(options.steps ?? 240)));
    const row: Point3[] = [];
    for (let i = 0; i <= steps; i += 1) row.push(at({ ...params, t: lerp(ranges.t, i, steps) }));
    return { kind: 'curve', source: input.source, rows: [row], error: null };
  }
  const rows: Point3[][] = [];
  for (let j = 0; j <= n; j += 1) {
    const v = lerp(ranges.v, j, n);
    const row: Point3[] = [];
    for (let i = 0; i <= n; i += 1) row.push(at({ ...params, u: lerp(ranges.u, i, n), v }));
    rows.push(row);
  }
  return { kind: 'parametricSurface', source: input.source, rows, error: null };
}
