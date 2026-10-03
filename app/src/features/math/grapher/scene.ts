// Puts the grapher's pieces together. `buildScene` turns expressions and a viewport into plain data: grid lines,
// ticks, and a path per curve. A screen view draws that data as React SVG, and `sceneToSvg` writes the same data
// as a standalone SVG string for print and export, where every line stays vector.

import { compileExpression, type ExpressionProblem, type Params } from './evaluate';
import { segmentsToPath, type PathOptions } from './path';
import { sampleFunction, type SampleOptions } from './sample';
import { computeGrid, DEFAULT_TICK_SPACING, type Grid, type Tick, type TickSpacing } from './ticks';
import type { Size, Viewport } from './types';

export interface CurveInput {
  /** The expression, such as `a sin(x) + b`. */
  readonly source: string;
  /** Values for the parameters the expression uses. */
  readonly params?: Params;
}

export interface CurveLayer {
  readonly source: string;
  /** SVG path data in pixels. Empty when the curve has an error or nothing of it is in view. */
  readonly d: string;
  /** Why the expression could not be drawn, or null. */
  readonly error: ExpressionProblem | null;
}

export interface GraphScene {
  readonly view: Viewport;
  readonly size: Size;
  readonly grid: Grid;
  readonly curves: readonly CurveLayer[];
}

export interface SceneOptions {
  readonly sampling?: SampleOptions;
  readonly path?: PathOptions;
  readonly tickSpacing?: TickSpacing;
}

function buildCurve(input: CurveInput, view: Viewport, size: Size, options: SceneOptions): CurveLayer {
  const params = input.params ?? {};
  const result = compileExpression(input.source, { parameters: Object.keys(params) });
  if (!result.ok) return { source: input.source, d: '', error: result.error };
  const { evaluate } = result.expression;
  const segments = sampleFunction((x) => evaluate(x, params), view, size, options.sampling);
  return { source: input.source, d: segmentsToPath(segments, view, size, options.path), error: null };
}

/** Everything needed to draw the graph for this viewport and size. One bad expression does not stop the others. */
export function buildScene(
  view: Viewport,
  size: Size,
  curves: readonly CurveInput[],
  options: SceneOptions = {},
): GraphScene {
  return {
    view,
    size,
    grid: computeGrid(view, size, options.tickSpacing ?? DEFAULT_TICK_SPACING),
    curves: curves.map((curve) => buildCurve(curve, view, size, options)),
  };
}

/** How the export looks. Colors and the font come from the caller, who resolves the design tokens to real values. */
export interface SvgStyle {
  readonly gridMinor: string;
  readonly gridMajor: string;
  readonly axis: string;
  readonly text: string;
  /** One color per curve, in order. They repeat when there are more curves than colors. */
  readonly curves: readonly string[];
  readonly fontFamily: string;
  /** The size of the tick labels, in the same units as the scene's pixels. */
  readonly labelSize: number;
  readonly lineWidth: number;
  readonly curveWidth: number;
  /** The accessible name of the graph. */
  readonly title: string;
  /** A longer text alternative, such as the expressions and the range in view. */
  readonly description?: string;
}

type Attributes = Readonly<Record<string, string | number>>;

const LABEL_GAP = 4;

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function num(value: number): string {
  return String(Number(value.toFixed(2)));
}

/** One SVG element as text. Numbers are rounded to a hundredth, and every value is escaped. */
function element(name: string, attributes: Attributes, content = ''): string {
  const list = Object.entries(attributes).map(([key, value]) => {
    return ` ${key}="${escapeXml(typeof value === 'number' ? num(value) : value)}"`;
  });
  return `<${name}${list.join('')}>${content}</${name}>`;
}

function path(d: string, attributes: Attributes): string {
  return d === '' ? '' : element('path', { d, fill: 'none', ...attributes });
}

function gridPath(ticks: readonly Tick[], major: boolean, line: (position: number) => string): string {
  return ticks
    .filter((t) => t.major === major)
    .map((t) => line(t.position))
    .join('');
}

function labelsSvg(scene: GraphScene, style: SvgStyle): string {
  const { grid } = scene;
  const below = grid.xAxis.edge === 'max' ? -LABEL_GAP : style.labelSize + LABEL_GAP;
  const beside = grid.yAxis.edge === 'min' ? LABEL_GAP : -LABEL_GAP;
  const anchor = grid.yAxis.edge === 'min' ? 'start' : 'end';
  const labelled = (ticks: readonly Tick[]) => ticks.filter((t) => t.major && t.label !== '');
  const xs = labelled(grid.x).map((t) =>
    element('text', { x: t.position, y: grid.xAxis.pixel + below, 'text-anchor': 'middle' }, escapeXml(t.label)),
  );
  // The x axis labels already show the origin, so the y axis skips its own zero.
  const ys = labelled(grid.y)
    .filter((t) => !(t.value === 0 && grid.xAxis.edge === null))
    .map((t) =>
      element(
        'text',
        { x: grid.yAxis.pixel + beside, y: t.position + style.labelSize / 3, 'text-anchor': anchor },
        escapeXml(t.label),
      ),
    );
  const font = { 'font-family': style.fontFamily, 'font-size': style.labelSize, fill: style.text };
  return element('g', font, [...xs, ...ys].join(''));
}

function curvesSvg(scene: GraphScene, style: SvgStyle): string {
  return scene.curves
    .map((curve, i) =>
      path(curve.d, {
        stroke: style.curves[i % style.curves.length] ?? style.axis,
        'stroke-width': style.curveWidth,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    )
    .join('');
}

function gridSvg(scene: GraphScene, style: SvgStyle): string {
  const { grid, size } = scene;
  const vertical = (x: number) => `M${num(x)} 0V${num(size.height)}`;
  const horizontal = (y: number) => `M0 ${num(y)}H${num(size.width)}`;
  const lines = (major: boolean) => gridPath(grid.x, major, vertical) + gridPath(grid.y, major, horizontal);
  const axes = `M0 ${num(grid.xAxis.pixel)}H${num(size.width)}M${num(grid.yAxis.pixel)} 0V${num(size.height)}`;
  return [
    path(lines(false), { stroke: style.gridMinor, 'stroke-width': style.lineWidth }),
    path(lines(true), { stroke: style.gridMajor, 'stroke-width': style.lineWidth }),
    path(axes, { stroke: style.axis, 'stroke-width': style.lineWidth * 1.5 }),
  ].join('');
}

/** The scene as a standalone SVG document string. It has no scripts, images, or external references. */
export function sceneToSvg(scene: GraphScene, style: SvgStyle): string {
  const { width, height } = scene.size;
  const svg: Attributes = {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: `0 0 ${num(width)} ${num(height)}`,
    width,
    height,
    role: 'img',
  };
  const desc = style.description === undefined ? '' : element('desc', {}, escapeXml(style.description));
  const inner = element('title', {}, escapeXml(style.title)) + desc;
  return element('svg', svg, inner + gridSvg(scene, style) + labelsSvg(scene, style) + curvesSvg(scene, style));
}
