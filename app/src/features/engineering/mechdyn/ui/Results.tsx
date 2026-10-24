// A tool's outcome in the window: the results table, any further tables, the plots, the assumptions, and the worked
// steps with typeset math. Everything a plot shows is also in the tables and steps, as text.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useMemo } from 'react';
import { SCREEN } from '../kit/picture';
import type { Outcome } from '../kit/spec';
import type { System } from '../kit/units';
import {
  cellWords,
  plotPicture,
  plotTitle,
  rowLabel,
  rowText,
  stepWords,
  type InsertContext,
  type Say,
} from './insert';
import styles from './mechdyn.module.css';

function Math({ latex }: { latex: string }) {
  // The LaTeX is built by the engines from numbers and fixed text; typed formulas go through the expression parser.
  const html = useMemo(
    () => katex.renderToString(latex, { throwOnError: false, displayMode: true, output: 'htmlAndMathml' }),
    [latex],
  );
  return <div className={styles.math} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Results({ tool, outcome, system, say }: { tool: string; outcome: Outcome; system: System; say: Say }) {
  const c: InsertContext = { tool, outcome, system, say };
  const pictures = useMemo(
    () => (outcome.plots ?? []).map((plot) => ({ title: plotTitle(say, plot), svg: plotPicture(say, plot, SCREEN) })),
    [outcome, say],
  );
  return (
    <>
      <section className={styles.section} aria-label={say('kitMechDyn.ui.results')}>
        <h3 className={styles.heading}>{say('kitMechDyn.ui.results')}</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{say('kitMechDyn.ui.quantity')}</th>
              <th scope="col">{say('kitMechDyn.ui.value')}</th>
            </tr>
          </thead>
          <tbody>
            {outcome.rows.map((row, i) => (
              <tr key={`${row.id}-${i}`} className={row.answer ? styles.answer : undefined}>
                <th scope="row">{rowLabel(c, row)}</th>
                <td className={styles.number}>{rowText(c, row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {outcome.tables?.map((table) => {
        const name = say(`kitMechDyn.${tool}.table.${table.id}`);
        return (
          <div key={table.id} className={styles.section}>
            <h3 className={styles.heading}>{name}</h3>
            <div className={styles.scroll} tabIndex={0} role="region" aria-label={name}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {table.columns.map((column) => (
                      <th key={column} scope="col">
                        {say(`kitMechDyn.${tool}.col.${column}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((cells, r) => (
                    <tr key={r}>
                      {cells.map((cell, i) => (
                        <td key={i} className={styles.number}>
                          {cellWords(c, cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {pictures.map((picture, i) => (
        <figure key={i} className={styles.figure}>
          <div role="img" aria-label={picture.title} dangerouslySetInnerHTML={{ __html: picture.svg }} />
          <figcaption className={styles.caption}>{picture.title}</figcaption>
        </figure>
      ))}
      {(outcome.notes?.length ?? 0) > 0 && (
        <section className={styles.section} aria-label={say('kitMechDyn.ui.assumptions')}>
          <h3 className={styles.heading}>{say('kitMechDyn.ui.assumptions')}</h3>
          <ul className={styles.notes}>
            {outcome.notes?.map((note) => (
              <li key={note}>{say(`kitMechDyn.${tool}.note.${note}`)}</li>
            ))}
          </ul>
        </section>
      )}
      {outcome.steps.length > 0 && (
        <section className={styles.section} aria-label={say('kitMechDyn.ui.steps')}>
          <h3 className={styles.heading}>{say('kitMechDyn.ui.steps')}</h3>
          {system === 'us' && <p className={styles.quiet}>{say('kitMechDyn.ui.stepsInSi')}</p>}
          <ol className={styles.stepList}>
            {outcome.steps.map((one, i) => (
              <li key={i}>
                <span>{stepWords(c, one)}</span>
                {one.math && <Math latex={one.math} />}
              </li>
            ))}
          </ol>
        </section>
      )}
      {outcome.sources?.map((source) => (
        <p key={source} className={styles.quiet}>
          {say('kitMechDyn.ui.source', { source })}
        </p>
      ))}
    </>
  );
}
