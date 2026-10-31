// A small line graph for the economics tools: curves, shaded areas, and labeled points, drawn as SVG on tokens.
// Curves differ by dash and by a label at their end, never by color alone, and the graph has a text summary for a
// screen reader (the steps beside it carry the numbers).
import { fmt } from './num';
import { H, PAD, W, layoutPlot } from './plotLayout';
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

export function Plot(props: PlotProps) {
  const { summary, xLabel, yLabel, curves, areas = [], marks = [] } = props;
  const { xt, yt, sx, sy, path } = layoutPlot(props);
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
