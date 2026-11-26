// What a kit tool shows after it works a problem: the results table (each row with a copy button), the worked steps
// with typeset math, the assumptions, the source of any data, and a problem in words. Everything is text first, so
// a screen reader and the clipboard get the same numbers the eye does.
import 'katex/dist/katex.min.css';
import { useEffect, useState } from 'react';
import { announce } from '../../../../ui';
import { VisuallyHidden } from '../../../../ui/VisuallyHidden';
import type { KitResultRow, KitStep } from '../types';
import { ScrollMath } from '../../ui/ScrollMath';
import { say, stepWords, stepsText } from './words';
import styles from './kit.module.css';

function copyText(text: string, done: string): void {
  void navigator.clipboard?.writeText(text).then(
    () => announce(done),
    () => undefined,
  );
}

const rowText = (row: KitResultRow): string => `${row.label} = ${row.value}${row.unit ? ` ${row.unit}` : ''}`;

export function ResultTable({ rows, title }: { rows: readonly KitResultRow[]; title?: string }) {
  if (rows.length === 0) return null;
  const heading = title ?? say('kits.results.title');
  // The answer comes first, so it is the first thing read.
  const ordered = [...rows.filter((row) => row.answer), ...rows.filter((row) => !row.answer)];
  return (
    <section className={styles.section} aria-label={heading}>
      <h3 className={styles.heading}>{heading}</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{say('kits.results.quantity')}</th>
            <th scope="col">{say('kits.results.value')}</th>
            <th scope="col">
              <VisuallyHidden>{say('kits.results.copyColumn')}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => (
            <tr key={row.id} className={row.answer ? styles.answer : undefined}>
              <th scope="row">{row.label}</th>
              <td className={styles.value}>{row.unit ? `${row.value} ${row.unit}` : row.value}</td>
              <td>
                <button
                  type="button"
                  className={styles.copy}
                  aria-label={say('kits.results.copy', { name: row.label })}
                  onClick={() => copyText(rowText(row), say('kits.results.copied', { name: row.label }))}
                >
                  {say('kits.results.copyButton')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** LaTeX built by a tool from numbers and fixed text (never from typed text), typeset with MathML for readers. */
export function MathLine({ latex, display = false }: { latex: string; display?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // The typesetter loads with the math feature; until then (or if the LaTeX has a mistake) the source shows.
    void import('../../../math').then((math) => {
      const result = math.renderLatex(latex, { displayMode: display });
      if (live) setHtml(result.ok ? result.html : null);
    });
    return () => {
      live = false;
    };
  }, [latex, display]);
  if (html === null) return <code className={styles.math}>{latex}</code>;
  return <ScrollMath className={styles.math} html={html} />;
}

export function StepsView({ steps, title }: { steps: readonly KitStep[]; title?: string }) {
  if (steps.length === 0) return null;
  const heading = title ?? say('kits.steps.title');
  return (
    <section className={styles.section} aria-label={heading}>
      <div className={styles.header}>
        <h3 className={styles.heading}>{heading}</h3>
        <button
          type="button"
          className={styles.copy}
          onClick={() => copyText(stepsText(steps, heading), say('kits.steps.copied'))}
        >
          {say('kits.steps.copy')}
        </button>
      </div>
      <ol className={styles.steps}>
        {steps.map((step, i) => (
          <li key={i}>
            <span>{stepWords(step)}</span>
            {step.math && <MathLine latex={step.math} />}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Assumptions({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <section className={styles.section} aria-label={say('kits.assumptions')}>
      <h3 className={styles.heading}>{say('kits.assumptions')}</h3>
      <ul className={styles.assumptions}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function SourceNote({ source }: { source: string }) {
  if (!source) return null;
  return <p className={styles.source}>{say('kits.source', { source })}</p>;
}

/** What is wrong with the inputs, announced politely when it changes. Empty text shows nothing. */
export function Problem({ text }: { text: string }) {
  return (
    <p className={styles.problem} role="status" aria-live="polite">
      {text}
    </p>
  );
}
