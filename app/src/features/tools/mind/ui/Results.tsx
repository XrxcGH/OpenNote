// A tool's outcome in the window: the results table, any further tables, the pictures, what the numbers mean,
// and the worked steps with typeset math. Everything a picture shows is also in the tables and steps, as text.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useMemo } from 'react';
import { fillMath } from '../kit/format';
import type { Outcome } from '../kit/spec';
import {
  cellText,
  columnLabel,
  pictureSvg,
  rowLabel,
  rowText,
  say,
  stepWords,
  toolKey,
  type InsertContext,
} from './insert';
import styles from './mind.module.css';

function Math({ latex }: { latex: string }) {
  // The LaTeX is built by the tool from numbers and fixed text, never from what a person typed.
  const html = useMemo(
    () => katex.renderToString(latex, { throwOnError: false, displayMode: true, output: 'htmlAndMathml' }),
    [latex],
  );
  return <div className={styles.math} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Tables({ c }: { c: InsertContext }) {
  return (
    <>
      {c.outcome.tables?.map((table) => {
        const name = say(toolKey(c, `table.${table.id}`));
        return (
          <section key={table.id} className={styles.section}>
            <h3 className={styles.heading}>{name}</h3>
            <div className={styles.scroll} tabIndex={0} role="region" aria-label={name}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {table.columns.map((column, i) => (
                      <th key={i} scope="col">
                        {columnLabel(c, column)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((cells, r) => (
                    <tr key={r}>
                      {cells.map((cell, i) =>
                        i === 0 ? (
                          <th key={i} scope="row" className={styles.number}>
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
          </section>
        );
      })}
    </>
  );
}

export function Results({ tool, outcome }: { tool: string; outcome: Outcome }) {
  const c: InsertContext = { tool, outcome };
  return (
    <>
      <section className={styles.section} aria-label={say('kitMind.ui.results')}>
        <h3 className={styles.heading}>{say('kitMind.ui.results')}</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{say('kitMind.ui.quantity')}</th>
              <th scope="col">{say('kitMind.ui.value')}</th>
            </tr>
          </thead>
          <tbody>
            {outcome.rows.map((row, i) => (
              <tr key={`${row.id}-${i}`} className={row.answer ? styles.answer : undefined}>
                <th scope="row">{rowLabel(c, row)}</th>
                <td className={styles.number}>{rowText(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {outcome.notes && outcome.notes.length > 0 && (
        <section className={styles.section} aria-label={say('kitMind.ui.notes')}>
          <h3 className={styles.heading}>{say('kitMind.ui.notes')}</h3>
          <ul className={styles.notes}>
            {outcome.notes.map((note, i) => (
              <li key={`${note.id}-${i}`}>{say(toolKey(c, `note.${note.id}`), note.vars)}</li>
            ))}
          </ul>
        </section>
      )}
      {outcome.pictures?.map((picture) => (
        <figure key={picture.id} className={styles.figure}>
          <div dangerouslySetInnerHTML={{ __html: pictureSvg(c, picture) }} />
          <figcaption className={styles.caption}>{say(toolKey(c, `picture.${picture.id}`))}</figcaption>
        </figure>
      ))}
      <Tables c={c} />
      {outcome.steps.length > 0 && (
        <section className={styles.section} aria-label={say('kitMind.ui.steps')}>
          <h3 className={styles.heading}>{say('kitMind.ui.steps')}</h3>
          <ol className={styles.stepList}>
            {outcome.steps.map((one, i) => (
              <li key={i}>
                <span>{stepWords(one.key, one.vars)}</span>
                {one.math && <Math latex={fillMath(one.math, one.vars)} />}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
