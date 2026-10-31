// The signals tools' plots: lines, stems, dots, and steps on linear or log axes with ticks, markers, and a legend,
// and a heat map for spectrograms and images. Both read as one sentence to a screen reader, and both can become a
// picture for the page with the theme's colors written in.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { t } from '../../../../strings/t';
import { fmt } from './num';
import type { HeatSpec, PlotSpec, Series } from './plotTypes';
import styles from './kit.module.css';

const W = 560;
const H = 300;
const PAD = { left: 56, right: 14, top: 14, bottom: 42 };
const MAX_POINTS = 1600;

/** Round tick values spanning [a, b]: steps of 1, 2, or 5 times a power of ten. */
export function niceTicks(a: number, b: number, count = 6): number[] {
  if (!(b > a)) return [a];
  const raw = (b - a) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 5, 10].find((m) => m * power >= raw)! * power;
  const out: number[] = [];
  for (let v = Math.ceil(a / unit) * unit; v <= b + unit * 1e-9; v += unit) out.push(Math.abs(v) < unit * 1e-9 ? 0 : v);
  return out;
}

function extent(values: ArrayLike<number>[], log: boolean): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const list of values) {
    for (let i = 0; i < list.length; i += 1) {
      const v = list[i]!;
      if (!Number.isFinite(v) || (log && v <= 0)) continue;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (lo === hi) return log ? [lo / 10, hi * 10] : [lo - 1, hi + 1];
  return [lo, hi];
}

/** At most MAX_POINTS points per series. Each bucket keeps its extremes, so peaks survive. */
function thin(series: Series): { x: number[]; y: number[] } {
  const n = series.x.length;
  // A series with gaps (several traces in one, as in an eye diagram) is drawn whole, so the gaps stay.
  if (n <= MAX_POINTS || Array.prototype.some.call(series.y, Number.isNaN)) {
    return { x: Array.from(series.x), y: Array.from(series.y) };
  }
  const x: number[] = [];
  const y: number[] = [];
  const bucket = Math.ceil(n / (MAX_POINTS / 2));
  for (let start = 0; start < n; start += bucket) {
    let lo = start;
    let hi = start;
    for (let i = start; i < Math.min(n, start + bucket); i += 1) {
      if (series.y[i]! < series.y[lo]!) lo = i;
      if (series.y[i]! > series.y[hi]!) hi = i;
    }
    for (const i of lo < hi ? [lo, hi] : [hi, lo]) {
      x.push(series.x[i]!);
      y.push(series.y[i]!);
    }
  }
  return { x, y };
}

function pathOf(kind: Series['kind'], px: number[], py: number[], zero: number): string {
  const parts: string[] = [];
  let pen = false;
  for (let i = 0; i < px.length; i += 1) {
    const [x, y] = [px[i]!, py[i]!];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    if (kind === 'stem') parts.push(`M${x.toFixed(1)},${zero.toFixed(1)}V${y.toFixed(1)}`);
    else if (kind === 'steps' && pen) parts.push(`H${x.toFixed(1)}V${y.toFixed(1)}`);
    else parts.push(`${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
    pen = true;
  }
  return parts.join('');
}

export interface PlotHandle {
  picture(name: string): Promise<{ bytes: ArrayBuffer; name: string; alt: string; mime: string } | null>;
}

const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-size', 'font-family', 'opacity'];

/** The SVG with each element's computed colors and sizes written in, so it looks the same outside the app. */
export function standaloneSvg(svg: SVGSVGElement): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const live = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const made = [copy, ...Array.from(copy.querySelectorAll('*'))];
  live.forEach((node, i) => {
    const style = window.getComputedStyle(node);
    const target = made[i] as SVGElement;
    target.removeAttribute('class');
    target.setAttribute('style', STYLE_PROPS.map((p) => `${p}:${style.getPropertyValue(p)}`).join(';'));
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const background = window.getComputedStyle(svg).getPropertyValue('background-color');
  copy.insertAdjacentHTML('afterbegin', `<rect width="100%" height="100%" fill="${background}"/>`);
  return new XMLSerializer().serializeToString(copy);
}

export const svgBytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

interface Frame {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  logX: boolean;
}

function useFrame(spec: PlotSpec): Frame {
  return useMemo(() => {
    const logX = Boolean(spec.logX);
    const [x0, x1] =
      spec.xRange ??
      extent(
        spec.series.map((s) => s.x),
        logX,
      );
    let [y0, y1] =
      spec.yRange ??
      extent(
        spec.series.map((s) => s.y),
        false,
      );
    if (!spec.yRange && spec.series.some((s) => s.kind === 'stem')) [y0, y1] = [Math.min(0, y0), Math.max(0, y1)];
    if (spec.square) {
      const half = Math.max(x1 - x0, y1 - y0, spec.circle ? 2.4 * spec.circle : 0) / 2;
      const [cx, cy] = spec.circle ? [0, 0] : [(x0 + x1) / 2, (y0 + y1) / 2];
      return { x0: cx - half * 1.1, x1: cx + half * 1.1, y0: cy - half * 1.1, y1: cy + half * 1.1, logX: false };
    }
    const pad = (y1 - y0) * 0.05;
    return { x0, x1, y0: y0 - pad, y1: y1 + pad, logX };
  }, [spec]);
}

interface Scale {
  readonly width: number;
  readonly innerW: number;
  readonly innerH: number;
  sx(v: number): number;
  sy(v: number): number;
  readonly xTicks: number[];
  readonly yTicks: number[];
}

function scaleOf(frame: Frame, square: boolean): Scale {
  const width = square ? H + PAD.left : W;
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const lx = (v: number) => (frame.logX ? Math.log10(Math.max(v, 1e-300)) : v);
  const xTicks = frame.logX
    ? niceTicks(Math.floor(lx(frame.x0)), Math.ceil(lx(frame.x1)), 6)
        .filter(Number.isInteger)
        .map((p) => 10 ** p)
        .filter((v) => v >= frame.x0 && v <= frame.x1)
    : niceTicks(frame.x0, frame.x1);
  return {
    width,
    innerW,
    innerH,
    sx: (v) => PAD.left + ((lx(v) - lx(frame.x0)) / (lx(frame.x1) - lx(frame.x0))) * innerW,
    sy: (v) => PAD.top + (1 - (v - frame.y0) / (frame.y1 - frame.y0)) * innerH,
    xTicks,
    yTicks: niceTicks(frame.y0, frame.y1, 5),
  };
}

function Axes({ scale, spec }: { scale: Scale; spec: PlotSpec }) {
  const { sx, sy, innerW, innerH } = scale;
  const middle = PAD.top + innerH / 2;
  return (
    <>
      <g className={styles.grid}>
        {scale.xTicks.map((v) => (
          <line key={`x${v}`} x1={sx(v)} x2={sx(v)} y1={PAD.top} y2={PAD.top + innerH} />
        ))}
        {scale.yTicks.map((v) => (
          <line key={`y${v}`} x1={PAD.left} x2={PAD.left + innerW} y1={sy(v)} y2={sy(v)} />
        ))}
      </g>
      <rect className={styles.frame} x={PAD.left} y={PAD.top} width={innerW} height={innerH} />
      <g className={styles.tickText}>
        {scale.xTicks.map((v) => (
          <text key={`tx${v}`} x={sx(v)} y={PAD.top + innerH + 14} textAnchor="middle">
            {fmt(v, 4)}
          </text>
        ))}
        {scale.yTicks.map((v) => (
          <text key={`ty${v}`} x={PAD.left - 6} y={sy(v) + 4} textAnchor="end">
            {fmt(v, 4)}
          </text>
        ))}
        <text x={PAD.left + innerW / 2} y={H - 6} textAnchor="middle">
          {spec.xLabel}
        </text>
        <text x={12} y={middle} textAnchor="middle" transform={`rotate(-90 12 ${middle})`}>
          {spec.yLabel}
        </text>
      </g>
    </>
  );
}

function SeriesPath({ series, index, scale, zero }: { series: Series; index: number; scale: Scale; zero: number }) {
  const { x, y } = thin(series);
  const px = x.map(scale.sx);
  const py = y.map(scale.sy);
  const tone = styles[`tone${(series.tone ?? index) % 5}`];
  if (series.kind === 'dots') {
    return (
      <g className={`${styles.dots} ${tone}`}>
        {px.map((cx, k) =>
          Number.isFinite(cx) && Number.isFinite(py[k]) ? <circle key={k} cx={cx} cy={py[k]} r={2.5} /> : null,
        )}
      </g>
    );
  }
  const dash = series.dashed ? styles.dashed : '';
  return <path className={`${styles.line} ${tone} ${dash}`} d={pathOf(series.kind, px, py, zero)} />;
}

function Layers({ scale, spec, frame }: { scale: Scale; spec: PlotSpec; frame: Frame }) {
  const { sx, sy, innerW, innerH } = scale;
  const zero = sy(Math.min(Math.max(0, frame.y0), frame.y1));
  return (
    <svg x={PAD.left} y={PAD.top} width={innerW} height={innerH} viewBox={`${PAD.left} ${PAD.top} ${innerW} ${innerH}`}>
      {spec.circle ? (
        <ellipse
          className={styles.circle}
          cx={sx(0)}
          cy={sy(0)}
          rx={sx(spec.circle) - sx(0)}
          ry={sy(0) - sy(spec.circle)}
        />
      ) : null}
      {spec.markers?.map((marker, i) => (
        <line
          key={i}
          className={styles.marker}
          x1={sx(marker.x)}
          x2={sx(marker.x)}
          y1={PAD.top}
          y2={PAD.top + innerH}
        />
      ))}
      {spec.series.map((series, i) => (
        <SeriesPath key={i} series={series} index={i} scale={scale} zero={zero} />
      ))}
    </svg>
  );
}

function Legend({ spec }: { spec: PlotSpec }) {
  if (spec.series.length < 2) return null;
  return (
    <figcaption className={styles.legend}>
      {spec.series.map((series, i) => (
        <span key={i} className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles[`tone${(series.tone ?? i) % 5}`]}`} aria-hidden="true" />
          {series.label}
        </span>
      ))}
    </figcaption>
  );
}

/** A plot of one or more series, with a summary sentence for screen readers. */
export const Plot = forwardRef<PlotHandle, { spec: PlotSpec; title: string }>(function Plot({ spec, title }, ref) {
  const svgRef = useRef<SVGSVGElement>(null);
  const frame = useFrame(spec);
  const scale = scaleOf(frame, Boolean(spec.square));
  const summary = t('kitSignals.ui.plotSummary', {
    title,
    x: spec.xLabel,
    x0: fmt(frame.x0, 4),
    x1: fmt(frame.x1, 4),
    y: spec.yLabel,
    y0: fmt(frame.y0, 4),
    y1: fmt(frame.y1, 4),
  });
  useImperativeHandle(ref, () => ({
    picture: async (name) =>
      svgRef.current
        ? { bytes: svgBytes(standaloneSvg(svgRef.current)), name: `${name}.svg`, alt: summary, mime: 'image/svg+xml' }
        : null,
  }));
  return (
    <figure className={styles.figure}>
      <svg ref={svgRef} className={styles.plot} viewBox={`0 0 ${scale.width} ${H}`} role="img" aria-label={summary}>
        <Axes scale={scale} spec={spec} />
        <Layers scale={scale} spec={spec} frame={frame} />
        {spec.markers?.map((marker, i) => (
          <text key={i} className={styles.markerText} x={scale.sx(marker.x) + 3} y={PAD.top + 12 + (i % 3) * 12}>
            {marker.label}
          </text>
        ))}
      </svg>
      <Legend spec={spec} />
    </figure>
  );
});

/** Perceptually even colors from dark to light (a viridis-like ramp), at a share from 0 to 1. */
export function ramp(share: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ];
  const s = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(s));
  const f = s - i;
  return [0, 1, 2].map((c) => Math.round(stops[i]![c]! + f * (stops[i + 1]![c]! - stops[i]![c]!))) as [
    number,
    number,
    number,
  ];
}

function zExtent(values: readonly Float64Array[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of values) for (const v of row) if (Number.isFinite(v)) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
  return Number.isFinite(lo) && hi > lo ? [lo, hi] : [0, 1];
}

/** A heat map drawn on a canvas with its axes, so the picture for the page is the canvas itself. */
export const HeatMap = forwardRef<PlotHandle, { spec: HeatSpec; title: string }>(function HeatMap(
  { spec, title },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [z0, z1] = spec.zRange ?? zExtent(spec.values);
  const summary = t('kitSignals.ui.heatSummary', {
    title,
    x: spec.xLabel,
    x0: fmt(spec.xRange[0], 4),
    x1: fmt(spec.xRange[1], 4),
    y: spec.yLabel,
    y0: fmt(spec.yRange[0], 4),
    y1: fmt(spec.yRange[1], 4),
    z0: fmt(z0, 4),
    z1: fmt(z1, 4),
  });
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    drawHeat(context, spec, [z0, z1], window.getComputedStyle(canvas));
  }, [spec, z0, z1]);
  useImperativeHandle(ref, () => ({
    picture: async (name) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      return blob ? { bytes: await blob.arrayBuffer(), name: `${name}.png`, alt: summary, mime: 'image/png' } : null;
    },
  }));
  return <canvas ref={canvasRef} className={styles.heat} width={W} height={H} role="img" aria-label={summary} />;
});

function drawHeat(
  context: CanvasRenderingContext2D,
  spec: HeatSpec,
  [z0, z1]: [number, number],
  style: CSSStyleDeclaration,
) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  context.fillStyle = style.backgroundColor || 'white';
  context.fillRect(0, 0, W, H);
  const rows = spec.values.length;
  const cols = spec.values[0]?.length ?? 0;
  if (rows && cols) {
    const image = context.createImageData(innerW, innerH);
    for (let py = 0; py < innerH; py += 1) {
      const row = spec.values[Math.min(rows - 1, Math.floor(((innerH - 1 - py) / innerH) * rows))]!;
      for (let px = 0; px < innerW; px += 1) {
        const [r, g, b] = ramp((row[Math.min(cols - 1, Math.floor((px / innerW) * cols))]! - z0) / (z1 - z0));
        const at = (py * innerW + px) * 4;
        image.data[at] = r;
        image.data[at + 1] = g;
        image.data[at + 2] = b;
        image.data[at + 3] = 255;
      }
    }
    context.putImageData(image, PAD.left, PAD.top);
  }
  context.fillStyle = style.color || 'black';
  context.font = style.font;
  context.textAlign = 'center';
  const [x0, x1] = spec.xRange;
  const [y0, y1] = spec.yRange;
  for (const v of niceTicks(x0, x1))
    context.fillText(fmt(v, 4), PAD.left + ((v - x0) / (x1 - x0)) * innerW, PAD.top + innerH + 14);
  context.fillText(spec.xLabel, PAD.left + innerW / 2, H - 6);
  context.textAlign = 'right';
  for (const v of niceTicks(y0, y1, 5))
    context.fillText(fmt(v, 4), PAD.left - 6, PAD.top + (1 - (v - y0) / (y1 - y0)) * innerH + 4);
  context.save();
  context.translate(12, PAD.top + innerH / 2);
  context.rotate(-Math.PI / 2);
  context.textAlign = 'center';
  context.fillText(spec.yLabel, 0, 0);
  context.restore();
}
