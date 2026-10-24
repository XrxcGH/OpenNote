// A small line graph for the economics tools: curves, shaded areas, and labeled points, drawn as SVG on tokens.
// Curves differ by dash and by a label at their end, never by color alone, and the graph has a text summary for a
// screen reader (the steps beside it carry the numbers).
import { fmt } from './num';
import styles from './plot.module.css';

export interface Curve {
  label: string;
  points: readonly (readonly [number, number])[];
  dashed?: boolean;
}
export interface Area {
  label: string;
  points: readonly (readonly [number, number])[];
}
export interface Mark {
  label: string;
  x: number;
  y: number;
}
export interface PlotProps {
  summary: string;
  xLabel: string;
  yLabel: string;
  curves: readonly Curve[];
  areas?: readonly Area[];
  marks?: readonly Mark[];
}

const W = 360;
const H = 240;
const PAD = { left: 44, right: 14, top: 12, bottom: 34 };

function ticks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

export function Plot({ summary, xLabel, yLabel, curves, areas = [], marks = [] }: PlotProps) {
  const all = [
    ...curves.flatMap((c) => c.points),
    ...areas.flatMap((a) => a.points),
    ...marks.map((m) => [m.x, m.y] as const),
  ];
  const xMax = Math.max(...all.map((p) => p[0]), 1e-9);
  const yMax = Math.max(...all.map((p) => p[1]), 1e-9);
  const xt = ticks(xMax);
  const yt = ticks(yMax);
  const xs = Math.max(xt[xt.length - 1], xMax);
  const ys = Math.max(yt[yt.length - 1], yMax);
  const sx = (x: number) => PAD.left + (x / xs) * (W - PAD.left - PAD.right);
  const sy = (y: number) => H - PAD.bottom - (y / ys) * (H - PAD.top - PAD.bottom);
  const path = (pts: readonly (readonly [number, number])[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join(' ');
  return (
    <figure className={styles.figure}>
      <svg className={styles.svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line className={styles.grid} x1={PAD.left} x2={W - PAD.right} y1={sy(v)} y2={sy(v)} />
            <text className={styles.tick} x={PAD.left - 6} y={sy(v) + 3} textAnchor="end">
              {fmt(v, 2)}
            </text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={`x${v}`} className={styles.tick} x={sx(v)} y={H - PAD.bottom + 14} textAnchor="middle">
            {fmt(v, 2)}
          </text>
        ))}
        <line className={styles.axis} x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} />
        <line className={styles.axis} x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} />
        {areas.map((a, i) => (
          <path key={a.label} className={i % 2 ? styles.areaB : styles.areaA} d={`${path(a.points)}Z`}>
            <title>{a.label}</title>
          </path>
        ))}
        {curves.map((c, i) => {
          const end = c.points[c.points.length - 1];
          return (
            <g key={c.label}>
              <path
                className={styles.curve}
                d={path(c.points)}
                strokeDasharray={c.dashed ? '6 4' : i % 3 === 2 ? '2 3' : undefined}
              />
              <text className={styles.label} x={Math.min(sx(end[0]) + 3, W - 40)} y={sy(end[1]) - 5}>
                {c.label}
              </text>
            </g>
          );
        })}
        {marks.map((m) => (
          <g key={m.label}>
            <circle className={styles.mark} cx={sx(m.x)} cy={sy(m.y)} r={4} />
            <text className={styles.label} x={sx(m.x) + 7} y={sy(m.y) - 7}>
              {m.label}
            </text>
          </g>
        ))}
        <text className={styles.axisLabel} x={(PAD.left + W - PAD.right) / 2} y={H - 4} textAnchor="middle">
          {xLabel}
        </text>
        <text className={styles.axisLabel} x={10} y={PAD.top + 8} textAnchor="start">
          {yLabel}
        </text>
      </svg>
      {areas.length > 0 ? (
        <figcaption className={styles.caption}>
          {areas.map((a) => (
            <span key={a.label}>{a.label}</span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
}
