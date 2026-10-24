// A life-systems plot in the window: axes on round numbers, one line or set of markers per series, and a legend that
// pairs each name with its dash pattern. The picture has a text name for screen readers; the numbers themselves are
// in the result table and the inserted table.
import type { PlotData } from '../types';
import { HEIGHT, WIDTH, plotModel } from './plotModel';
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
        {model.paths.map((path) =>
          path.points ? (
            <g key={path.index} className={styles[`series${path.index % 5}`]}>
              {path.markers.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={2.5} className={styles.marker} />
              ))}
            </g>
          ) : (
            <path
              key={path.index}
              d={path.d}
              className={`${styles.line} ${styles[`series${path.index % 5}`]}`}
              strokeDasharray={path.dash}
            />
          ),
        )}
      </svg>
      <figcaption className={styles.legend}>
        {model.paths.map((path) => (
          <span key={path.index} className={styles.legendItem}>
            <svg width="24" height="8" aria-hidden="true" className={styles[`series${path.index % 5}`]}>
              {path.points ? (
                <circle cx="12" cy="4" r="3" className={styles.marker} />
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
