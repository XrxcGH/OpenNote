// Math and graphs for print and PDF (pages/export/renderers.ts loads this on demand). Both come out as vector markup
// that a browser prints as shapes and text: an equation as MathML, which WebView2 lays out with its own math font and
// tags for screen readers, and a graph as the standalone SVG the grapher writes. Neither needs a style sheet, so the
// print document stays small. They use the light colors whatever theme the screen shows.
import { tokens } from '../../theme/tokens';
import { t } from '../../strings/t';
import { buildScene, defaultViewport, sceneToSvg } from './grapher';
import { lineParameters } from './grapher/curves';
import type { SvgStyle } from './grapher';
import { renderMarkup } from './latex/engine';
import { readGraph } from './graph/source';
import type { GraphSource } from './graph/source';
import { DEFAULT_DOMAIN, plotParameters, samplePlot } from './grapher3d/plot';
import { DEFAULT_CAMERA, boundsOf, buildScene3d, sceneToSvg3d, tickText } from './grapher3d/scene';
import { exportSpace } from './space/render';
import { is3dGraph } from './space/source3d';
import { stripLabels } from '../../editor/equations';

const SIZE = { width: 640, height: 360 };

/** The MathML for some LaTeX, or null when KaTeX rejects it. */
export function exportMath(latex: string, display: boolean): string | null {
  try {
    return renderMarkup(stripLabels(latex), display, 'mathml');
  } catch {
    return null;
  }
}

function style(title: string, description: string): SvgStyle {
  const c = tokens.color.light;
  return {
    gridMinor: c.border.subtle,
    gridMajor: c.border.control,
    axis: c.text.primary,
    text: c.text.secondary,
    curves: [c.accent.primary, c.accent.clay, c.accent.night, c.accent.dusk, c.accent.candle],
    fontFamily: tokens.font.ui,
    labelSize: 12,
    lineWidth: 1,
    curveWidth: 2.5,
    title,
    description,
  };
}

/** A 3D graph as an SVG string, drawn from the camera its text saved. */
function export3d(graph: GraphSource): string {
  const params: Record<string, number> = {};
  for (const line of graph.functions) for (const name of plotParameters(line)) params[name] = graph.params[name] ?? 1;
  for (const [name, value] of Object.entries(graph.params)) params[name] = value;
  const domain = graph.view ?? DEFAULT_DOMAIN;
  const samples = graph.functions.map((line) =>
    samplePlot({ source: line, params }, { domain, ranges: graph.ranges ?? {}, grid: 40 }),
  );
  const bounds = boundsOf(samples, domain);
  const scene = buildScene3d(samples, graph.camera ?? DEFAULT_CAMERA, SIZE, bounds);
  const [x, y, z] = [bounds.x, bounds.y, bounds.z].map(([lo, hi]) => ({ lo: tickText(lo), hi: tickText(hi) }));
  const description = t('mathTools.graph3d.exportDescription', {
    functions: graph.functions.join('; '),
    xLo: x.lo,
    xHi: x.hi,
    yLo: y.lo,
    yHi: y.hi,
    zLo: z.lo,
    zHi: z.hi,
  });
  const c = tokens.color.light;
  const base = style(t('mathTools.graph3d.exportTitle'), description);
  return sceneToSvg3d(scene, {
    paper: c.surface.page,
    box: c.border.subtle,
    axis: c.text.secondary,
    text: c.text.secondary,
    curves: base.curves,
    fontFamily: base.fontFamily,
    labelSize: base.labelSize,
    title: base.title,
    description,
  });
}

/** The graph a `graph` code block describes, as an SVG string. Null when the block plots nothing. */
export function exportGraph(source: string): string | null {
  if (is3dGraph(source)) return exportSpace(source); // The print bundle has no flags.
  const graph = readGraph(source);
  if (graph.functions.length === 0) return null;
  // The print bundle has no flags, so a 3D graph's text always prints as 3D.
  if (graph.three) return export3d(graph);
  const view = graph.view ?? defaultViewport(SIZE);
  const params: Record<string, number> = {};
  for (const line of graph.functions) for (const name of lineParameters(line)) params[name] = graph.params[name] ?? 1;
  for (const [name, value] of Object.entries(graph.params)) params[name] = value;
  const scene = buildScene(
    view,
    SIZE,
    graph.functions.map((line) => ({ source: line, params, ...(graph.t ? { t: graph.t } : {}) })),
  );
  const description = t('smart.grapher.exportDescription', {
    functions: graph.functions.join('; '),
    xMin: view.xMin,
    xMax: view.xMax,
    yMin: view.yMin,
    yMax: view.yMax,
  });
  return sceneToSvg(scene, style(t('smart.grapher.exportTitle'), description));
}
