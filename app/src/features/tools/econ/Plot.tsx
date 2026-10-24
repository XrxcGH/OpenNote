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

function ticks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step)
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export function Plot({ summary, xLabel, yLabel, curves, areas = [], marks = [] }: PlotProps) {
  const all = [
    ...curves.flatMap((c) => c.points),
    ...areas.flatMap((a) => a.points),
    ...marks.map((m) => [m.x, m.y] as const),
  ];
  const xLow = Math.min(0, ...all.map((p) => p[0]));
  const yLow = Math.min(0, ...all.map((p) => p[1]));
  const xHigh = Math.max(...all.map((p) => p[0]), xLow + 1e-9);
  const yHigh = Math.max(...all.map((p) => p[1]), yLow + 1e-9);
  const xt = ticks(xLow, xHigh);
  const yt = ticks(yLow, yHigh);
  const x0 = Math.min(xLow, xt[0]);
  const y0 = Math.min(yLow, yt[0]);
  const x1 = Math.max(xHigh, xt[xt.length - 1]);
  const y1 = Math.max(yHigh, yt[yt.length - 1]);
  const sx = (x: number) => PAD.left + ((x - x0) / (x1 - x0)) * (W - PAD.left - PAD.right);
  const sy = (y: number) => H - PAD.bottom - ((y - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);
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
        <line className={styles.axis} x1={sx(0)} x2={sx(0)} y1={PAD.top} y2={H - PAD.bottom} />
        <line className={styles.axis} x1={PAD.left} x2={W - PAD.right} y1={sy(0)} y2={sy(0)} />
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
