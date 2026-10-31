// A graph as one self-contained SVG for Insert graph: the light theme's colors, since a stored figure is shown as an
// image and cannot follow the app's theme. Every label is escaped, so no input text becomes markup.
import { tokens } from '../../../theme/tokens';
import { el } from '../subjects/layout/svg';
import { fmt } from './num';
import type { PlotProps } from './Plot';
import { H, PAD, W, layoutPlot } from './plotLayout';

const c = tokens.color.light;

export function plotSvg(props: PlotProps): string {
  const { summary, xLabel, yLabel, curves, areas = [], marks = [] } = props;
  const { xt, yt, sx, sy, path } = layoutPlot(props);
  const text = (x: number, y: number, label: string, fill: string, anchor = 'start') =>
    el('text', { x, y, fill, 'font-size': 10, 'text-anchor': anchor }, escape(label));
  const escape = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
  const height = H + (areas.length ? 8 + areas.length * 13 : 0);
  const parts: string[] = [el('rect', { width: W, height, fill: c.surface.page })];
  for (const v of yt) {
    parts.push(el('line', { x1: PAD.left, x2: W - PAD.right, y1: sy(v), y2: sy(v), stroke: c.border.subtle }));
    parts.push(text(PAD.left - 6, sy(v) + 3, fmt(v, 2), c.text.secondary, 'end'));
  }
  for (const v of xt) parts.push(text(sx(v), H - PAD.bottom + 14, fmt(v, 2), c.text.secondary, 'middle'));
  parts.push(el('line', { x1: sx(0), x2: sx(0), y1: PAD.top, y2: H - PAD.bottom, stroke: c.text.secondary }));
  parts.push(el('line', { x1: PAD.left, x2: W - PAD.right, y1: sy(0), y2: sy(0), stroke: c.text.secondary }));
  areas.forEach((a, i) =>
    parts.push(
      el(
        'path',
        {
          d: `${path(a.points)}Z`,
          fill: i % 2 ? c.status.danger : c.accent.primary,
          'fill-opacity': i % 2 ? 0.2 : 0.22,
        },
        el('title', {}, escape(a.label)),
      ),
    ),
  );
  curves.forEach((k, i) => {
    const end = k.points[k.points.length - 1];
    const dash = k.dashed ? '6 4' : i % 3 === 2 ? '2 3' : '';
    parts.push(
      el('path', {
        d: path(k.points),
        fill: 'none',
        stroke: c.text.primary,
        'stroke-width': 2,
        ...(dash ? { 'stroke-dasharray': dash } : {}),
      }),
    );
    parts.push(text(Math.min(sx(end[0]) + 3, W - 40), sy(end[1]) - 5, k.label, c.text.primary));
  });
  for (const m of marks) {
    parts.push(el('circle', { cx: sx(m.x), cy: sy(m.y), r: 4, fill: c.accent.primary, stroke: c.surface.page }));
    parts.push(text(sx(m.x) + 7, sy(m.y) - 7, m.label, c.text.primary));
  }
  parts.push(text((PAD.left + W - PAD.right) / 2, H - 4, xLabel, c.text.secondary, 'middle'));
  parts.push(text(10, PAD.top + 8, yLabel, c.text.secondary));
  // The shaded areas are named under the graph, as the on-screen caption does.
  const legend = areas.map((a, i) =>
    el('text', { x: 8, y: H + 12 + i * 13, fill: c.text.secondary, 'font-size': 10 }, escape(a.label)),
  );
  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${W} ${height}`,
      width: W,
      height,
      role: 'img',
      'font-family': tokens.font.ui,
      'aria-label': summary,
    },
    [...parts, ...legend].join(''),
  );
}
