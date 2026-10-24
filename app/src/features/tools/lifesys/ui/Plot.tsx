// A life-systems plot in the window: axes on round numbers, one line or set of markers per series, and a legend that
// pairs each name with its dash pattern. The picture has a text name for screen readers; the numbers themselves are
// in the result table and the inserted table.
import type { PlotData } from '../types';
import { HEIGHT, WIDTH, plotModel } from './plotModel';
import type { PlotPath } from './plotModel';
import styles from './lifesys.module.css';
import { word } from './words';

export function plotLabels(plot: PlotData) {
  return {
    title: word(plot.title, plot.vars),
    x: word(plot.x.label, plot.x.vars),
    y: word(plot.y.label, plot.y.vars),
    names: plot.series.map((s) => word(s.name, s.vars)),
  };
}

function Series({ path }: { path: PlotPath }) {
  const tone = styles[`series${path.index % 5}`];
  if (path.kind === 'points')
    return (
      <g className={tone}>
        {path.markers.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2.5} className={styles.marker} />
        ))}
      </g>
    );
  if (path.kind === 'bars' || path.kind === 'outline')
    return (
      <g className={tone}>
        {path.rects.map((r, i) => (
          <rect
            key={i}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            className={path.kind === 'bars' ? styles.bar : styles.outline}
            strokeDasharray={path.kind === 'outline' ? path.dash : undefined}
          />
        ))}
      </g>
    );
  return <path d={path.d} className={`${styles.line} ${tone}`} strokeDasharray={path.dash} />;
}

export function Plot({ plot }: { plot: PlotData }) {
  const model = plotModel(plot);
  const labels = plotLabels(plot);
  const { frame } = model;
  const summary = word('ui.plotSummary', {
    title: labels.title,
    x: labels.x,
    y: labels.y,
    names: labels.names.join(', '),
  });
  return (
    <figure className={styles.figure}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={summary} className={styles.plot}>
        <path className={styles.axis} d={`M${frame.left} ${frame.top}V${frame.bottom}H${frame.right}`} />
        {model.xTicks.map((tick) => (
          <g key={`x${tick.at}`}>
            <path className={styles.gridLine} d={`M${tick.at} ${frame.top}V${frame.bottom}`} />
            <text className={styles.tick} x={tick.at} y={frame.bottom + 14} textAnchor="middle">
              {tick.label}
            </text>
          </g>
        ))}
        {model.yTicks.map((tick) => (
          <g key={`y${tick.at}`}>
            <path className={styles.gridLine} d={`M${frame.left} ${tick.at}H${frame.right}`} />
            <text className={styles.tick} x={frame.left - 4} y={tick.at + 3} textAnchor="end">
              {tick.label}
            </text>
          </g>
        ))}
        <text className={styles.tick} x={(frame.left + frame.right) / 2} y={HEIGHT - 6} textAnchor="middle">
          {labels.x}
        </text>
        <text
          className={styles.tick}
          transform={`translate(12 ${(frame.top + frame.bottom) / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {labels.y}
        </text>
        {model.paths.map((path) => (
          <Series key={path.index} path={path} />
        ))}
      </svg>
      <figcaption className={styles.legend}>
        {model.paths.map((path) => (
          <span key={path.index} className={styles.legendItem}>
            <svg width="24" height="8" aria-hidden="true" className={styles[`series${path.index % 5}`]}>
              {path.kind === 'points' ? (
                <circle cx="12" cy="4" r="3" className={styles.marker} />
              ) : path.kind === 'bars' ? (
                <rect x="2" y="1" width="20" height="6" className={styles.bar} />
              ) : (
                <path d="M0 4H24" className={styles.line} strokeDasharray={path.dash} />
              )}
            </svg>
            {labels.names[path.index]}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
