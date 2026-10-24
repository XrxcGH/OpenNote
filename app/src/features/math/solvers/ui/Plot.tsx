// The solvers' plot: a quiet SVG on the page color with the grapher's grid, axes, and tick labels, and layers on
// top: lines, shaded areas, line segments, dots, field arrows, and bars. Curves use the brand's pens, every color is
// a token, and the picture always has a name; the worked steps beside it carry the same facts in words.
import { useId, useRef } from 'react';
import { computeGrid, toPixel, type Viewport } from '../../grapher';
import type { XY } from '../steps';
import { useSvgScale } from '../../svgScale';
import styles from './solvers.module.css';

export const PENS = [
  '--ink-indigo',
  '--ink-amber',
  '--ink-fern',
  '--ink-brick',
  '--ink-plum',
  '--ink-walnut',
  '--ink-ink',
];

export interface PlotLayer {
  readonly kind: 'line' | 'area' | 'segments' | 'dots' | 'arrows' | 'bars';
  /** A line, an area's outline, or dots. A NaN y breaks a line. */
  readonly points?: readonly XY[];
  /** Separate polylines, or two-point segments. */
  readonly lines?: readonly (readonly XY[])[];
  readonly arrows?: readonly { readonly x: number; readonly y: number; readonly dx: number; readonly dy: number }[];
  readonly bars?: readonly { readonly x: number; readonly y: number; readonly shaded: boolean }[];
  readonly tone?: number;
  readonly dashed?: boolean;
  readonly faint?: boolean;
  /** A name for the legend. */
  readonly label?: string;
}

export interface PlotProps {
  readonly layers: readonly PlotLayer[];
  /** The accessible name. */
  readonly label: string;
  readonly view?: Viewport;
  /** Keep one unit the same length on both axes. */
  readonly equal?: boolean;
  /** Points that set the view without being drawn. */
  readonly include?: readonly XY[];
  /** A dot that moves, such as a projectile in flight. */
  readonly marker?: XY | null;
}

const SIZE = { width: 480, height: 280 };

function pointsOf(layer: PlotLayer): XY[] {
  return [
    ...(layer.points ?? []),
    ...(layer.lines ?? []).flat(),
    ...(layer.arrows ?? []).map((a) => ({ x: a.x, y: a.y })),
    ...(layer.bars ?? []).flatMap((b) => [
      { x: b.x - 0.5, y: 0 },
      { x: b.x + 0.5, y: b.y },
    ]),
  ];
}

/** A view around every finite point, padded, and squared up when asked. */
export function fitView(points: readonly XY[], equal = false): Viewport {
  const xs = points.map((p) => p.x).filter(Number.isFinite);
  const ys = points.map((p) => p.y).filter(Number.isFinite);
  let [x0, x1] = xs.length ? [Math.min(...xs), Math.max(...xs)] : [-1, 1];
  let [y0, y1] = ys.length ? [Math.min(...ys), Math.max(...ys)] : [-1, 1];
  if (x1 - x0 < 1e-9) [x0, x1] = [x0 - 1, x1 + 1];
  if (y1 - y0 < 1e-9) [y0, y1] = [y0 - 1, y1 + 1];
  const [px, py] = [(x1 - x0) * 0.08, (y1 - y0) * 0.1];
  let view = { xMin: x0 - px, xMax: x1 + px, yMin: y0 - py, yMax: y1 + py };
  if (equal) {
    const scale = Math.max((view.xMax - view.xMin) / SIZE.width, (view.yMax - view.yMin) / SIZE.height);
    const [cx, cy] = [(view.xMax + view.xMin) / 2, (view.yMax + view.yMin) / 2];
    view = {
      xMin: cx - (scale * SIZE.width) / 2,
      xMax: cx + (scale * SIZE.width) / 2,
      yMin: cy - (scale * SIZE.height) / 2,
      yMax: cy + (scale * SIZE.height) / 2,
    };
  }
  return view;
}

function pathOf(points: readonly XY[], view: Viewport, close = false): string {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      pen = false;
      continue;
    }
    const px = toPixel(view, SIZE, p);
    // Far outside the view, a point is pulled in so the path stays drawable.
    const x = Math.max(-1e4, Math.min(1e4, px.x));
    const y = Math.max(-1e4, Math.min(1e4, px.y));
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  }
  return close && d ? `${d}Z` : d;
}

// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
export function Plot({ layers, label, view: given, equal = false, include = [], marker = null }: PlotProps) {
  const clip = useId();
  const svg = useRef<SVGSVGElement>(null);
  useSvgScale(svg, SIZE.width);
  const view = given ?? fitView([...layers.flatMap(pointsOf), ...include], equal);
  const grid = computeGrid(view, SIZE);
  const color = (layer: PlotLayer) => `var(${PENS[(layer.tone ?? 0) % PENS.length]})`;
  const legend = layers.filter((layer) => layer.label);
  const markerAt =
    marker && Number.isFinite(marker.x) && Number.isFinite(marker.y) ? toPixel(view, SIZE, marker) : null;
  return (
    <figure className={styles.figure}>
      <svg ref={svg} className={styles.plot} viewBox={`0 0 ${SIZE.width} ${SIZE.height}`} role="img" aria-label={label}>
        <defs>
          <clipPath id={clip}>
            <rect width={SIZE.width} height={SIZE.height} />
          </clipPath>
        </defs>
        <rect className={styles.paper} width={SIZE.width} height={SIZE.height} />
        <g aria-hidden="true">
          {grid.x
            .filter((tick) => tick.major)
            .map((tick) => (
              <line
                key={`x${tick.value}`}
                className={styles.gridLine}
                x1={tick.position}
                x2={tick.position}
                y1={0}
                y2={SIZE.height}
              />
            ))}
          {grid.y
            .filter((tick) => tick.major)
            .map((tick) => (
              <line
                key={`y${tick.value}`}
                className={styles.gridLine}
                y1={tick.position}
                y2={tick.position}
                x1={0}
                x2={SIZE.width}
              />
            ))}
          <line className={styles.axis} x1={0} x2={SIZE.width} y1={grid.xAxis.pixel} y2={grid.xAxis.pixel} />
          <line className={styles.axis} y1={0} y2={SIZE.height} x1={grid.yAxis.pixel} x2={grid.yAxis.pixel} />
        </g>
        <g clipPath={`url(#${clip})`} aria-hidden="true">
          {layers.map((layer, i) => {
            const stroke = color(layer);
            const dash = layer.dashed ? '6 4' : undefined;
            const opacity = layer.faint ? 0.45 : 1;
            if (layer.kind === 'area')
              return (
                <path
                  key={i}
                  className={styles.area}
                  d={pathOf(layer.points ?? [], view, true)}
                  style={{ fill: stroke }}
                />
              );
            if (layer.kind === 'line')
              return (
                <path
                  key={i}
                  className={styles.curve}
                  d={pathOf(layer.points ?? [], view)}
                  style={{ stroke }}
                  strokeDasharray={dash}
                  opacity={opacity}
                />
              );
            if (layer.kind === 'segments')
              return (
                <g key={i} style={{ stroke }} opacity={opacity}>
                  {(layer.lines ?? []).map((line, j) => (
                    <path key={j} className={styles.segment} d={pathOf(line, view)} strokeDasharray={dash} />
                  ))}
                </g>
              );
            if (layer.kind === 'dots')
              return (
                <g key={i} style={{ fill: stroke }}>
                  {(layer.points ?? [])
                    .filter((p) => Number.isFinite(p.y))
                    .map((p, j) => {
                      const at = toPixel(view, SIZE, p);
                      return <circle key={j} cx={at.x} cy={at.y} r={3.5} />;
                    })}
                </g>
              );
            if (layer.kind === 'arrows')
              return (
                <g key={i} style={{ stroke }} className={styles.arrow}>
                  {(layer.arrows ?? []).map((a, j) => {
                    const at = toPixel(view, SIZE, a);
                    const [dx, dy] = [a.dx * 7, -a.dy * 7];
                    return (
                      <g key={j}>
                        <line x1={at.x - dx} y1={at.y - dy} x2={at.x + dx} y2={at.y + dy} />
                        <circle cx={at.x + dx} cy={at.y + dy} r={1.4} style={{ fill: stroke }} />
                      </g>
                    );
                  })}
                </g>
              );
            return (
              <g key={i}>
                {(layer.bars ?? []).map((b, j) => {
                  const top = toPixel(view, SIZE, { x: b.x - 0.4, y: b.y });
                  const bottom = toPixel(view, SIZE, { x: b.x + 0.4, y: 0 });
                  return (
                    <rect
                      key={j}
                      x={top.x}
                      y={top.y}
                      width={Math.max(1, bottom.x - top.x)}
                      height={Math.max(0, bottom.y - top.y)}
                      className={b.shaded ? styles.barOn : styles.barOff}
                      style={b.shaded ? { fill: stroke } : undefined}
                    />
                  );
                })}
              </g>
            );
          })}
          {markerAt && <circle className={styles.marker} cx={markerAt.x} cy={markerAt.y} r={5} />}
        </g>
        <g aria-hidden="true">
          {grid.x
            .filter((tick) => tick.major && tick.label && tick.value !== 0)
            .map((tick) => {
              // A label near either edge hangs inward, so its first and last characters are never cut off.
              const half = (tick.label?.length ?? 1) * 3.2;
              const anchor =
                tick.position < half + 2 ? 'start' : tick.position > SIZE.width - half - 2 ? 'end' : 'middle';
              const x = anchor === 'start' ? 3 : anchor === 'end' ? SIZE.width - 3 : tick.position;
              return (
                <text
                  key={`lx${tick.value}`}
                  className={styles.tick}
                  x={x}
                  y={Math.min(SIZE.height - 5, Math.max(12, grid.xAxis.pixel + 15))}
                  textAnchor={anchor}
                >
                  {tick.label}
                </text>
              );
            })}
          {grid.y
            .filter((tick) => tick.major && tick.label && tick.value !== 0)
            .map((tick) => (
              <text
                key={`ly${tick.value}`}
                className={styles.tick}
                y={Math.min(SIZE.height - 4, Math.max(11, tick.position + 4))}
                x={Math.min(SIZE.width - 22, Math.max(4, grid.yAxis.pixel + 6))}
              >
                {tick.label}
              </text>
            ))}
        </g>
      </svg>
      {legend.length > 0 && (
        <figcaption className={styles.legend}>
          {legend.map((layer, i) => (
            <span key={i} className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: color(layer) }} aria-hidden="true" />
              {layer.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
