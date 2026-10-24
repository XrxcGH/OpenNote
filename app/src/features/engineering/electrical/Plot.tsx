// A small line plot of a tool's curve, drawn as SVG on theme colors. It is a picture of numbers that are also in the
// results table, so it is described in words for screen readers rather than read point by point.
import { t } from '../../../strings/t';
import { fmt } from './shared';
import type { Plot as PlotData } from './shared';
import styles from './kit.module.css';

const W = 480;
const H = 260;
const PAD = { left: 52, right: 12, top: 12, bottom: 36 };
const COLORS = ['var(--color-accent-primary)', 'var(--color-text-secondary)', 'var(--color-text-primary)'];

interface Layout {
  paths: string[];
  dots: [number, number][][];
  xTicks: [number, string][];
  yTicks: [number, string][];
}

function layout(plot: PlotData): Layout {
  const xs = plot.series.flatMap((s) => s.x).filter(Number.isFinite);
  const ys = plot.series.flatMap((s) => s.y).filter(Number.isFinite);
  const tx = (v: number) => (plot.logX ? Math.log10(Math.max(v, 1e-300)) : v);
  const x0 = Math.min(...xs.map(tx));
  const x1 = Math.max(...xs.map(tx));
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  if (y0 === y1) {
    y0 -= 1;
    y1 += 1;
  }
  const pad = (y1 - y0) * 0.05;
  y0 -= pad;
  y1 += pad;
  const sx = (v: number) => PAD.left + ((tx(v) - x0) / (x1 - x0 || 1)) * (W - PAD.left - PAD.right);
  const sy = (v: number) => H - PAD.bottom - ((v - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);
  const points = plot.series.map((s) =>
    s.x
      .map((x, i) => [sx(x), sy(s.y[i]!)] as [number, number])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)),
  );
  const xTicks: [number, string][] = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = x0 + f * (x1 - x0);
    return [PAD.left + f * (W - PAD.left - PAD.right), fmt(plot.logX ? 10 ** v : v, 3)];
  });
  const yTicks: [number, string][] = [0, 0.5, 1].map((f) => {
    const v = y0 + f * (y1 - y0);
    return [H - PAD.bottom - f * (H - PAD.top - PAD.bottom), fmt(v, 3)];
  });
  return {
    paths: plot.dots
      ? []
      : points.map((p) => p.map(([a, b], i) => `${i === 0 ? 'M' : 'L'}${a.toFixed(1)} ${b.toFixed(1)}`).join(' ')),
    dots: plot.dots ? points : [],
    xTicks,
    yTicks,
  };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * The plot as a standalone SVG file, for inserting into a page as a picture. It draws in the current text color on a
 * transparent background, so it reads on a light or a dark page; a second curve is dashed.
 */
export function plotSvg(plot: PlotData): string {
  const { paths, dots, xTicks, yTicks } = layout(plot);
  const dash = (i: number) => (i === 0 ? '' : ' stroke-dasharray="6 4"');
  const lines = paths
    .map((d, i) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2"${dash(i)}/>`)
    .join('');
  const circles = dots
    .flatMap((set) => set.map(([a, b]) => `<circle cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="3"/>`))
    .join('');
  const label = (x: number, y: number, anchor: string, text: string, extra = '') =>
    `<text x="${x}" y="${y}" font-size="11" text-anchor="${anchor}"${extra}>${esc(text)}</text>`;
  const xt = xTicks.map(([a, l]) => label(a, H - 18, 'middle', l)).join('');
  const yt = yTicks.map(([b, l]) => label(PAD.left - 6, b + 4, 'end', l)).join('');
  const box = `x="${PAD.left}" y="${PAD.top}" width="${W - PAD.left - PAD.right}" height="${H - PAD.top - PAD.bottom}"`;
  const turn = ` transform="rotate(-90 12 ${H / 2})"`;
  const axes = label(W / 2, H - 3, 'middle', plot.xLabel) + label(12, H / 2, 'middle', plot.yLabel, turn);
  const frame = `<rect ${box} fill="none" stroke="currentColor" stroke-opacity="0.4"/>`;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
  return `${open}${frame}${lines}${circles}${xt}${yt}${axes}</svg>`;
}

export function Plot({ plot }: { plot: PlotData }) {
  const { paths, dots, xTicks, yTicks } = layout(plot);
  const label = t('kitElectrical.plotLabel', { x: plot.xLabel, y: plot.yLabel });
  return (
    <svg className={styles.plot} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <rect
        x={PAD.left}
        y={PAD.top}
        width={W - PAD.left - PAD.right}
        height={H - PAD.top - PAD.bottom}
        fill="none"
        stroke="var(--color-border-control)"
      />
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="2" />
      ))}
      {dots.flatMap((set, i) =>
        set.map(([a, b], j) => <circle key={`${i}-${j}`} cx={a} cy={b} r="3" fill={COLORS[i % COLORS.length]} />),
      )}
      {xTicks.map(([a, l]) => (
        <text key={`x${a}`} x={a} y={H - 18} fontSize="11" textAnchor="middle" fill="currentColor">
          {l}
        </text>
      ))}
      {yTicks.map(([b, l]) => (
        <text key={`y${b}`} x={PAD.left - 6} y={b + 4} fontSize="11" textAnchor="end" fill="currentColor">
          {l}
        </text>
      ))}
      <text x={W / 2} y={H - 3} fontSize="12" textAnchor="middle" fill="currentColor">
        {plot.xLabel}
      </text>
      <text
        x="12"
        y={H / 2}
        fontSize="12"
        textAnchor="middle"
        fill="currentColor"
        transform={`rotate(-90 12 ${H / 2})`}
      >
        {plot.yLabel}
      </text>
    </svg>
  );
}
