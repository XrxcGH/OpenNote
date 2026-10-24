// Draws a plot as SVG text from its description: the grid and ticks, marks such as phase changes, the series as
// lines, steps, points with error bars, or bars, the axis names, and a legend that names each series.
import { numText } from './format';
import {
  DASHES,
  el,
  escapeXml,
  extent,
  marker,
  ticks,
  type Attrs,
  type Palette,
  type PlotSeries,
  type PlotSpec,
} from './plot';

interface Frame {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly plotW: number;
  readonly plotH: number;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  px(x: number): number;
  py(y: number): number;
}

const named = (spec: PlotSpec) => spec.series.filter((series) => series.label !== undefined || series.id !== '');

function frameOf(spec: PlotSpec): Frame {
  const legend = Math.ceil(named(spec).length / 2) * 18;
  const width = spec.square ? 360 : 480;
  const height = (spec.square ? 360 : 300) + legend;
  const left = 60;
  const top = 16;
  const plotW = width - left - 16;
  const plotH = height - top - 44 - legend;
  const xs = spec.series.flatMap((s) => s.points.map((p) => p[0])).concat((spec.marks ?? []).map((one) => one.x));
  const ys = spec.series.flatMap((s) =>
    s.points.flatMap((p, i) => [p[1] - (s.errors?.[i] ?? 0), p[1] + (s.errors?.[i] ?? 0)]),
  );
  if (spec.series.some((s) => s.kind === 'bars')) ys.push(0);
  const [x0, x1] = extent(xs, spec.x.min, spec.x.max);
  const [y0, y1] = extent(ys, spec.y.min, spec.y.max);
  return {
    width,
    height,
    left,
    top,
    plotW,
    plotH,
    x0,
    x1,
    y0,
    y1,
    px: (x) => left + ((x - x0) / (x1 - x0)) * plotW,
    py: (y) => top + plotH - ((y - y0) / (y1 - y0)) * plotH,
  };
}

function gridSvg(f: Frame, palette: Palette, small: Attrs): string {
  const bottom = f.top + f.plotH;
  const right = f.left + f.plotW;
  const down = ticks(f.x0, f.x1).map(
    (t) =>
      el('line', { x1: f.px(t), y1: f.top, x2: f.px(t), y2: bottom, stroke: palette.grid }) +
      el('text', { x: f.px(t), y: bottom + 14, 'text-anchor': 'middle', ...small }, numText(t, 4)),
  );
  const across = ticks(f.y0, f.y1).map(
    (t) =>
      el('line', { x1: f.left, y1: f.py(t), x2: right, y2: f.py(t), stroke: palette.grid }) +
      el('text', { x: f.left - 6, y: f.py(t) + 4, 'text-anchor': 'end', ...small }, numText(t, 4)),
  );
  return down.join('') + across.join('');
}

function marksSvg(spec: PlotSpec, f: Frame, palette: Palette, small: Attrs): string {
  const parts: string[] = [];
  if (spec.diagonal) {
    const lo = Math.max(f.x0, f.y0);
    const hi = Math.min(f.x1, f.y1);
    const line = { x1: f.px(lo), y1: f.py(lo), x2: f.px(hi), y2: f.py(hi) };
    parts.push(el('line', { ...line, stroke: palette.muted, 'stroke-dasharray': '3 3' }));
  }
  for (const mark of spec.marks ?? []) {
    const x = f.px(mark.x);
    const line = { x1: x, y1: f.top, x2: x, y2: f.top + f.plotH };
    parts.push(el('line', { ...line, stroke: palette.muted, 'stroke-dasharray': '5 4' }));
    if (mark.label) parts.push(el('text', { x, y: f.top + 10, dx: 4, ...small }, escapeXml(mark.label)));
  }
  return parts.join('');
}

function legendSvg(spec: PlotSpec, f: Frame, palette: Palette, label: (id: string) => string, big: Attrs): string {
  return named(spec)
    .map((series, i) => {
      const x = f.left + (i % 2) * (f.plotW / 2);
      const y = f.top + f.plotH + 50 + Math.floor(i / 2) * 18;
      const index = series.pen ?? spec.series.indexOf(series);
      const color = palette.pens[index % palette.pens.length];
      const dash = series.dashed ? '6 4' : DASHES[index % DASHES.length];
      const line = {
        x1: x,
        y1: y - 4,
        x2: x + 20,
        y2: y - 4,
        stroke: color,
        'stroke-width': 2,
        'stroke-dasharray': dash,
      };
      const swatch = series.kind === 'points' ? marker(index, x + 10, y - 4, color) : el('line', line);
      return swatch + el('text', { x: x + 26, y, ...big }, escapeXml(series.label ?? label(series.id)));
    })
    .join('');
}

function pointsSvg(series: PlotSeries, index: number, color: string, f: Frame): string {
  const bars = (series.errors ?? []).map((e, i) => {
    const p = series.points[i];
    if (!p || !Number.isFinite(e) || e === 0) return '';
    const x = f.px(p[0]);
    return el('line', { x1: x, y1: f.py(p[1] - e), x2: x, y2: f.py(p[1] + e), stroke: color, 'stroke-width': 1.5 });
  });
  const shown = series.points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  return bars.join('') + shown.map((p) => marker(index, f.px(p[0]), f.py(p[1]), color)).join('');
}

function barsSvg(series: PlotSeries, color: string, f: Frame): string {
  const base = f.py(Math.max(f.y0, 0));
  const sorted = series.points.filter((p) => Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  const gap = sorted.length > 1 ? Math.abs(f.px(sorted[1][0]) - f.px(sorted[0][0])) : 20;
  const style = { fill: color, 'fill-opacity': 0.35, stroke: color };
  return sorted
    .map((p) => {
      const box = { x: f.px(p[0]) - gap * 0.45, y: Math.min(f.py(p[1]), base), width: gap * 0.9 };
      return el('rect', { ...box, height: Math.abs(base - f.py(p[1])), ...style });
    })
    .join('');
}

function seriesSvg(series: PlotSeries, index: number, palette: Palette, f: Frame): string {
  const color = palette.pens[index % palette.pens.length];
  if (series.kind === 'points') return pointsSvg(series, index, color, f);
  if (series.kind === 'bars') return barsSvg(series, color, f);
  const runs: string[][] = [[]];
  series.points.forEach((p, i) => {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      runs.push([]);
      return;
    }
    const run = runs[runs.length - 1];
    const at = (y: number) => `${f.px(p[0]).toFixed(1)},${f.py(y).toFixed(1)}`;
    if (series.kind === 'steps' && run.length > 0) run.push(at(series.points[i - 1][1]));
    run.push(at(p[1]));
  });
  const dash = series.dashed ? '6 4' : DASHES[index % DASHES.length];
  const style = { fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-dasharray': dash };
  return runs
    .filter((run) => run.length > 1)
    .map((run) => el('polyline', { points: run.join(' '), ...style }))
    .join('');
}

/** The plot as SVG text. `label` turns a plot key into words; `title` names the picture for screen readers. */
export function plotSvg(spec: PlotSpec, palette: Palette, label: (id: string) => string, title: string): string {
  const f = frameOf(spec);
  const small = { 'font-family': palette.font, 'font-size': 11, fill: palette.muted };
  const big = { 'font-family': palette.font, 'font-size': 12, fill: palette.text };
  const xAt = { x: f.left + f.plotW / 2, y: f.top + f.plotH + 32, 'text-anchor': 'middle', ...big };
  const yAt = { transform: `translate(14 ${f.top + f.plotH / 2}) rotate(-90)`, 'text-anchor': 'middle', ...big };
  const body = [
    `<title>${escapeXml(title)}</title>`,
    el('rect', { width: f.width, height: f.height, fill: palette.surface }),
    gridSvg(f, palette, small),
    marksSvg(spec, f, palette, small),
    spec.series.map((one, index) => seriesSvg(one, one.pen ?? index, palette, f)).join(''),
    el('rect', { x: f.left, y: f.top, width: f.plotW, height: f.plotH, fill: 'none', stroke: palette.muted }),
    el('text', xAt, escapeXml(label(spec.x.id))),
    el('text', yAt, escapeXml(label(spec.y.id))),
    legendSvg(spec, f, palette, label, big),
  ];
  const size = { viewBox: `0 0 ${f.width} ${f.height}`, width: f.width, height: f.height, role: 'img' };
  return el('svg', { xmlns: 'http://www.w3.org/2000/svg', ...size }, body.join(''));
}
