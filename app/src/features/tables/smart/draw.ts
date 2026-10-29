// Draws a chart spec as SVG (Phase 7). Bars, lines, areas, and dots go through Observable Plot, which loads here and
// nowhere else, so a page without charts never fetches it. A pie has no Plot mark, so it is drawn directly.
// Patterns for color-blind readers are SVG patterns made from the spec's definitions.
import type { ChartSpec, PatternDef, PieSlice, PlotMarks } from '../engine';
import { realizePlot } from '../engine';

const SVG = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

const LINES: Record<PatternDef['kind'], readonly string[]> = {
  solid: [],
  diagonal: ['M-2 2 L2 -2 M0 8 L8 0 M6 10 L10 6'],
  'reverse-diagonal': ['M-2 6 L2 10 M0 0 L8 8 M6 -2 L10 2'],
  horizontal: ['M0 4 H8'],
  vertical: ['M4 0 V8'],
  dots: [],
  crosshatch: ['M-2 2 L2 -2 M0 8 L8 0 M6 10 L10 6', 'M-2 6 L2 10 M0 0 L8 8 M6 -2 L10 2'],
};

/** An SVG `<defs>` holding the chart's patterns: the series color as the tile, the page color as its marks. */
export function patternDefsElement(defs: readonly PatternDef[]): SVGDefsElement {
  const holder = el('defs');
  for (const def of defs) {
    const pattern = el('pattern', {
      id: def.id,
      width: def.size,
      height: def.size,
      patternUnits: 'userSpaceOnUse',
    });
    pattern.append(el('rect', { width: def.size, height: def.size, fill: def.background }));
    for (const d of LINES[def.kind]) {
      pattern.append(el('path', { d, stroke: def.line, 'stroke-width': 1.4, fill: 'none' }));
    }
    if (def.kind === 'dots') {
      pattern.append(el('circle', { cx: def.size / 2, cy: def.size / 2, r: 1.3, fill: def.line }));
    }
    holder.append(pattern);
  }
  return holder;
}

function slicePath(slice: PieSlice, cx: number, cy: number, radius: number): string {
  const point = (angle: number) => `${cx + radius * Math.sin(angle)} ${cy - radius * Math.cos(angle)}`;
  const large = slice.endAngle - slice.startAngle > Math.PI ? 1 : 0;
  return `M${cx} ${cy} L${point(slice.startAngle)} A${radius} ${radius} 0 ${large} 1 ${point(slice.endAngle)} Z`;
}

function pieSvg(spec: ChartSpec): SVGSVGElement {
  const slices = spec.pie ?? [];
  const size = Math.min(spec.width, spec.height);
  const svg = el('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  const radius = size / 2 - 8;
  const centre = size / 2;
  if (slices.length === 1) {
    svg.append(el('circle', { cx: centre, cy: centre, r: radius, fill: slices[0].style.paint }));
  } else {
    for (const slice of slices) {
      svg.append(
        el('path', {
          d: slicePath(slice, centre, centre, radius),
          fill: slice.style.paint,
          stroke: 'var(--color-surface-page)',
          'stroke-width': 1.5,
        }),
      );
    }
  }
  return svg;
}

async function plotSvg(spec: ChartSpec): Promise<SVGSVGElement> {
  const Plot = await import('@observablehq/plot');
  const chart = Plot.plot(realizePlot(Plot as unknown as PlotMarks, spec.plot!) as never);
  return chart instanceof SVGSVGElement ? chart : chart.querySelector('svg')!;
}

/** The chart as an SVG element. */
export async function drawChart(spec: ChartSpec): Promise<SVGSVGElement> {
  const svg = spec.pie ? pieSvg(spec) : await plotSvg(spec);
  if (spec.patternDefs.length > 0) svg.prepend(patternDefsElement(spec.patternDefs));
  return svg;
}
