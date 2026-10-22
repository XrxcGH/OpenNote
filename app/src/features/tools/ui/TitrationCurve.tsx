// The titration curve as a plain SVG: pH against volume of titrant, with the equivalence point marked. A text summary
// stands in for the picture for a screen reader.
import { t } from '../../../strings/t';
import { curve, phAt } from '../chem/calc/titration';
import type { Titration } from '../chem/calc/titration';
import styles from './chem.module.css';
import extra from './extra.module.css';

const W = 320;
const H = 190;
const PAD = { l: 34, r: 10, t: 10, b: 28 };

export function TitrationCurve({ titration, equivalence }: { titration: Titration; equivalence: number }) {
  const points = curve(titration);
  const maxV = points[points.length - 1].v;
  const x = (v: number) => PAD.l + (v / maxV) * (W - PAD.l - PAD.r);
  const y = (ph: number) => PAD.t + ((14 - ph) / 14) * (H - PAD.t - PAD.b);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.v).toFixed(1)} ${y(p.ph).toFixed(1)}`).join(' ');
  const label = t('chem.calc.curveLabel', {
    start: phAt(titration, 0).toFixed(1),
    volume: Number(equivalence.toPrecision(4)),
    end: points[points.length - 1].ph.toFixed(1),
  });
  return (
    <figure className={styles.figure}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <line className={styles.axis} x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} />
        <line className={styles.axis} x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} />
        {[0, 7, 14].map((ph) => (
          <text key={ph} className={styles.tick} x={PAD.l - 6} y={y(ph) + 4} textAnchor="end">
            {ph}
          </text>
        ))}
        <line
          className={styles.axis}
          x1={x(equivalence)}
          y1={PAD.t}
          x2={x(equivalence)}
          y2={H - PAD.b}
          strokeDasharray="4 3"
        />
        <path className={styles.plot} d={path} />
        <text className={styles.tick} x={x(equivalence)} y={H - 10} textAnchor="middle">
          {Number(equivalence.toPrecision(3))}
        </text>
        <text className={styles.tick} x={PAD.l + 2} y={PAD.t + 10}>
          {t('chem.data.ph')}
        </text>
      </svg>
      <figcaption className={extra.hidden}>{label}</figcaption>
    </figure>
  );
}
