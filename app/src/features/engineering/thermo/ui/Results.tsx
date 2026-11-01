// A tool's answer: the result table in the chosen units, the assumptions and source, the plot, and the worked
// steps with their math rendered by KaTeX (with MathML for screen readers). The table and steps are plain text,
// so every number is readable without the plot.
import '../text';
import 'katex/dist/katex.min.css';
import { renderLatex } from '../../../math';
import { t } from '../../../../strings/t';
import type { ThermoResult } from '../common/types';
import type { System } from '../common/units';
import { plotSvg, SCREEN_COLORS } from './plotSvg';
import { plotWords, rowName, shown, stepText } from './present';
import { say } from './say';
import styles from './thermo.module.css';

function MathPart({ source }: { source: string }) {
  const drawn = renderLatex(source, { displayMode: false });
  if (!drawn.ok) return <code className={styles.math}>{source}</code>;
  return <span className={styles.math} dangerouslySetInnerHTML={{ __html: drawn.html }} />;
}

export function ResultTable({ result, system }: { result: ThermoResult; system: System }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.heading}>{t('kitThermo.ui.results')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('kitThermo.ui.quantity')}</th>
            <th scope="col">{t('kitThermo.ui.value')}</th>
            <th scope="col">{t('kitThermo.ui.unit')}</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => {
            const { value, unit } = shown(row, system, say);
            return (
              <tr key={`${row.key}-${i}`}>
                <th scope="row">{rowName(row, say)}</th>
                <td className={styles.number}>{value}</td>
                <td>{unit}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Notes({ result }: { result: ThermoResult }) {
  if (!result.notes.length && !result.source) return null;
  return (
    <section className={styles.section} aria-label={t('kitThermo.ui.assumptions')}>
      {result.notes.length ? (
        <ul className={styles.notes}>
          {result.notes.map((note) => (
            <li key={note}>{say(`kitThermo.note.${note}`)}</li>
          ))}
        </ul>
      ) : null}
      {result.source ? <p className={styles.note}>{t('kitThermo.ui.source', { source: result.source })}</p> : null}
    </section>
  );
}

export function PlotView({ result, system }: { result: ThermoResult; system: System }) {
  return (result.plots ?? []).map((plot) => {
    const name = t('kitThermo.ui.plotLabel', { title: say(`kitThermo.plot.${plot.title}`) });
    const svg = plotSvg(plotWords(plot, say), system, SCREEN_COLORS, name);
    return <div key={plot.title} className={styles.plot} dangerouslySetInnerHTML={{ __html: svg }} />;
  });
}

export function StepsView({ result }: { result: ThermoResult }) {
  if (!result.steps.length) return null;
  return (
    <section className={styles.section} aria-label={t('kitThermo.ui.steps')}>
      <h3 className={styles.heading}>{t('kitThermo.ui.steps')}</h3>
      <ol className={styles.steps}>
        {result.steps.map((step, i) => (
          <li key={i}>
            <span>{stepText(step, say)}</span>
            {step.math ? <MathPart source={step.math} /> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
