// A tool's outcome in the window: the results table, any further tables, the plots, the assumptions, and the worked
// steps with typeset math. Everything a plot shows is also in the tables and steps, as text.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useMemo } from 'react';
import { SCREEN } from './plot';
import { columnText, plotText, rowLabel, rowText, stepText, type InsertContext } from './insert';
import styles from './control.module.css';

function Math({ latex }: { latex: string }) {
  // The LaTeX is built by the tool from numbers and fixed text, never from what a person typed.
  const html = useMemo(
    () => katex.renderToString(latex, { throwOnError: false, displayMode: true, output: 'htmlAndMathml' }),
    [latex],
  );
  return <div className={styles.math} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Plots({ c }: { c: InsertContext }) {
  const plots = c.outcome.plots ?? [];
  return (
    <>
      {plots.map((plot, i) => (
        <figure key={`${plot.id}-${i}`} className={styles.figure}>
          {/* The SVG is built from numbers and the kit's own words, escaped; nothing typed reaches it as markup. */}
          <div dangerouslySetInnerHTML={{ __html: plotText(c, plot, SCREEN) }} />
        </figure>
      ))}
    </>
  );
}

function Tables({ c }: { c: InsertContext }) {
  return (
    <>
      {(c.outcome.tables ?? []).map((table) => (
        <div key={table.id} className={styles.scroll}>
          <table className={styles.table}>
            <caption className={styles.caption}>{c.say(`kitControl.${c.tool}.table.${table.id}`)}</caption>
            <thead>
              <tr>
                {table.columns.map((col, k) => (
                  <th key={k} scope="col">
                    {columnText(c, col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, k) => (
                    <td key={k} className={k ? styles.number : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

export function Results({ c }: { c: InsertContext }) {
  const { outcome, say } = c;
  return (
    <>
      <section className={styles.section} aria-label={say('kitControl.ui.results')}>
        <h3 className={styles.heading}>{say('kitControl.ui.results')}</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{say('kitControl.ui.quantity')}</th>
              <th scope="col">{say('kitControl.ui.value')}</th>
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
        {outcome.latex && <Math latex={outcome.latex} />}
        <Tables c={c} />
        <Plots c={c} />
        {outcome.notes && outcome.notes.length > 0 && (
          <ul className={styles.notes} aria-label={say('kitControl.ui.assumptions')}>
            {outcome.notes.map((note) => (
              <li key={note.id}>{say(`kitControl.${c.tool}.note.${note.id}`, note.vars)}</li>
            ))}
          </ul>
        )}
      </section>
      {outcome.steps.length > 0 && (
        <section className={styles.section} aria-label={say('kitControl.ui.steps')}>
          <h3 className={styles.heading}>{say('kitControl.ui.steps')}</h3>
          <ol className={styles.stepList}>
            {outcome.steps.map((one, i) => (
              <li key={i}>
                <span>{stepText(c, one)}</span>
                {one.math && <Math latex={one.math} />}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
