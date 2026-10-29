// What the subject tools show besides kit-core's results: a coefficient table that says in words whether each
// estimate differs from zero (never with stars alone), and a figure shown as an image with an Insert figure button.
import { useState } from 'react';
import { Button, announce } from '../../../../ui';
import kitStyles from '../../kits/ui/kit.module.css';
import { svgDataUrl } from '../figure/model';
import type { KitFigureData } from '../figure/model';
import { insertFigure } from './insertFigure';
import styles from './subjects.module.css';
import { formatNumber, sayS } from './words';

export interface CoefficientRow {
  term: string;
  estimate: number;
  se: number;
  statistic: number;
  p: number;
  low: number;
  high: number;
}

/** The verdict a row's p-value gives at `alpha`, in words. */
export const verdictWords = (p: number, alpha: number): string =>
  sayS(p < alpha ? 'coef.significant' : 'coef.notSignificant');

export interface CoefficientTableProps {
  rows: readonly CoefficientRow[];
  /** The interval's confidence level, such as 0.95; the verdict uses 1 − level. */
  level?: number;
  title?: string;
  /** The statistic's name, such as t or z. */
  statistic?: string;
}

export function CoefficientTable({ rows, level = 0.95, title, statistic }: CoefficientTableProps) {
  if (rows.length === 0) return null;
  const alpha = 1 - level;
  const heading = title ?? sayS('coef.title');
  const pct = (x: number) => formatNumber(x * 100, 4);
  return (
    <section className={kitStyles.section} aria-label={heading}>
      <h3 className={kitStyles.heading}>{heading}</h3>
      <div className={styles.gridScroll}>
        <table className={kitStyles.table}>
          <thead>
            <tr>
              <th scope="col">{sayS('coef.term')}</th>
              <th scope="col">{sayS('coef.estimate')}</th>
              <th scope="col">{sayS('coef.se')}</th>
              <th scope="col">{statistic ?? sayS('coef.statistic')}</th>
              <th scope="col">{sayS('coef.p')}</th>
              <th scope="col">{sayS('coef.ci', { level: pct(level) })}</th>
              <th scope="col">{sayS('coef.verdict', { alpha: pct(alpha) })}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.term}>
                <th scope="row">{row.term}</th>
                <td className={kitStyles.value}>{formatNumber(row.estimate)}</td>
                <td className={kitStyles.value}>{formatNumber(row.se)}</td>
                <td className={kitStyles.value}>{formatNumber(row.statistic, 4)}</td>
                <td className={kitStyles.value}>{row.p < 1e-4 ? '< 0.0001' : formatNumber(row.p, 4)}</td>
                <td className={kitStyles.value}>
                  {sayS('coef.range', { low: formatNumber(row.low), high: formatNumber(row.high) })}
                </td>
                <td>{verdictWords(row.p, alpha)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A laid-out drawing as an image (never inlined markup), its alternative text, and an Insert figure button. */
export function SvgDiagram({ figure, caption }: { figure: KitFigureData; caption?: string }) {
  const [note, setNote] = useState('');
  const insert = () => {
    const done = insertFigure(figure);
    const words = sayS(done ? 'figure.inserted' : 'figure.noPage');
    setNote(words);
    announce(words);
  };
  return (
    <figure className={styles.figure}>
      <img src={svgDataUrl(figure.svg)} alt={figure.alt} />
      {caption && <figcaption className={styles.caption}>{caption}</figcaption>}
      <div className={styles.row}>
        <Button onClick={insert}>{sayS('figure.insert')}</Button>
      </div>
      {note && <p className={styles.status}>{note}</p>}
    </figure>
  );
}
