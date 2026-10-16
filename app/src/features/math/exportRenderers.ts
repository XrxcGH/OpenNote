// Math and graphs for print and PDF (pages/export/renderers.ts loads this on demand). Both come out as vector markup
// that a browser prints as shapes and text: an equation as MathML, which WebView2 lays out with its own math font and
// tags for screen readers, and a graph as the standalone SVG the grapher writes. Neither needs a style sheet, so the
// print document stays small. They use the light colors whatever theme the screen shows.
import { tokens } from '../../theme/tokens';
import { t } from '../../strings/t';
import { buildScene, defaultViewport, findParameters, sceneToSvg } from './grapher';
import type { SvgStyle } from './grapher';
import { renderMarkup } from './latex/engine';
import { readGraph } from './graph/source';

const SIZE = { width: 640, height: 360 };

/** The MathML for some LaTeX, or null when KaTeX rejects it. */
export function exportMath(latex: string, display: boolean): string | null {
  try {
    return renderMarkup(latex, display, 'mathml');
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

/** The graph a `graph` code block describes, as an SVG string. Null when the block plots nothing. */
export function exportGraph(source: string): string | null {
  const graph = readGraph(source);
  if (graph.functions.length === 0) return null;
  const view = graph.view ?? defaultViewport(SIZE);
  const params: Record<string, number> = {};
  for (const line of graph.functions) for (const name of findParameters(line)) params[name] = graph.params[name] ?? 1;
  for (const [name, value] of Object.entries(graph.params)) params[name] = value;
  const scene = buildScene(
    view,
    SIZE,
    graph.functions.map((line) => ({ source: line, params })),
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
