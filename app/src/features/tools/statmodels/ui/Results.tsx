// A tool's outcome in the window: the results table, the fitted equation, the result in words, the further tables,
// the pictures, the assumptions, and the worked steps with typeset math. Everything a picture shows is also in the
// tables and steps, as text.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useMemo } from 'react';
import { fillMath } from '../kit/format';
import type { Outcome } from '../kit/spec';
import {
  cellText,
  columnName,
  pictureName,
  pictureSvg,
  rowLabel,
  rowText,
  stepWords,
  type InsertContext,
  type Say,
} from './insert';
import styles from './statmodels.module.css';

function MathBlock({ latex }: { latex: string }) {
  // The LaTeX is built by the tool from numbers, column names escaped as text, and fixed text.
  const html = useMemo(
    () => katex.renderToString(latex, { throwOnError: false, displayMode: true, output: 'htmlAndMathml' }),
    [latex],
  );
  return <div className={styles.math} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Tables({ c }: { c: InsertContext }) {
  const { tool, outcome, say } = c;
  return outcome.tables?.map((table) => {
    const name = say(`kitStatModels.${tool}.table.${table.id}`);
    return (
      <div key={table.id} className={styles.section}>
        <h3 className={styles.heading}>{name}</h3>
        <div className={styles.scroll} tabIndex={0} role="region" aria-label={name}>
          <table className={styles.table}>
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th key={column} scope="col">
                    {columnName(c, column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((cells, r) => (
                <tr key={r}>
                  {cells.map((cell, i) =>
                    i === 0 && typeof cell === 'string' ? (
                      <th key={i} scope="row">
                        {cellText(c, cell)}
                      </th>
                    ) : (
                      <td key={i} className={styles.number}>
                        {cellText(c, cell)}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  });
}

export function Results({ tool, outcome, say }: { tool: string; outcome: Outcome; say: Say }) {
  const c: InsertContext = { tool, outcome, say };
  return (
    <>
      <section className={styles.section} aria-label={say('kitStatModels.ui.results')}>
        <h3 className={styles.heading}>{say('kitStatModels.ui.results')}</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{say('kitStatModels.ui.quantity')}</th>
              <th scope="col">{say('kitStatModels.ui.value')}</th>
            </tr>
          </thead>
          <tbody>
            {outcome.rows.map((row) => (
              <tr key={row.id} className={row.answer ? styles.answer : undefined}>
                <th scope="row">{rowLabel(c, row)}</th>
                <td className={styles.number}>{rowText(c, row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {outcome.equation && <MathBlock latex={outcome.equation} />}
        {outcome.words && <p className={styles.words}>{stepWords(c, outcome.words)}</p>}
      </section>
      <Tables c={c} />
      {outcome.pictures?.map((picture) => (
        <figure key={picture.id} className={styles.figure}>
          <div
            role="img"
            aria-label={pictureName(c, picture)}
            dangerouslySetInnerHTML={{ __html: pictureSvg(c, picture) }}
          />
          <figcaption className={styles.caption} aria-hidden="true">
            {pictureName(c, picture)}
          </figcaption>
        </figure>
      ))}
      {outcome.notes && outcome.notes.length > 0 && (
        <section className={styles.section} aria-label={say('kitStatModels.ui.assumptions')}>
          <h3 className={styles.heading}>{say('kitStatModels.ui.assumptions')}</h3>
          <ul className={styles.notes}>
            {outcome.notes.map((note) => (
              <li key={note}>{say(`kitStatModels.${tool}.note.${note}`)}</li>
            ))}
          </ul>
        </section>
      )}
      {outcome.steps.length > 0 && (
        <section className={styles.section} aria-label={say('kitStatModels.ui.steps')}>
          <h3 className={styles.heading}>{say('kitStatModels.ui.steps')}</h3>
          <ol className={styles.stepList}>
            {outcome.steps.map((one, i) => (
              <li key={i}>
                <span>{stepWords(c, one)}</span>
                {one.math && <MathBlock latex={fillMath(one.math, one.vars)} />}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
