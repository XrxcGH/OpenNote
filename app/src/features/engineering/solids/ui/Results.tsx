// A tool's outcome in the window: the results table, any further tables, the picture, the assumptions, and the
// worked steps with typeset math. Everything a picture shows is also in the tables and steps, as text.
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useMemo } from 'react';
import { fillMath, valueText, wordValues } from '../kit/format';
import { SCREEN, plotSvg } from '../kit/picture';
import type { Outcome } from '../kit/spec';
import type { System } from '../kit/units';
import { rowLabel, rowText, type InsertContext, type Say } from './insert';
import styles from './solids.module.css';

/** The SVG text of an outcome's picture, in the given palette; null when it has none. */
export function pictureSvg(c: InsertContext, palette = SCREEN): string | null {
  const picture = c.outcome.picture;
  if (!picture) return null;
  const ctx = { system: c.system, palette, say: (key: string) => c.say(key) };
  return picture.type === 'plot' ? plotSvg(picture.plot, ctx, `kitSolids.${c.tool}`) : picture.draw(ctx);
}

function Math({ latex }: { latex: string }) {
  // The LaTeX is built by the tool from numbers and fixed text, never from what a person typed.
  const html = useMemo(
    () => katex.renderToString(latex, { throwOnError: false, displayMode: true, output: 'htmlAndMathml' }),
    [latex],
  );
  return <div className={styles.math} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Results({ tool, outcome, system, say }: { tool: string; outcome: Outcome; system: System; say: Say }) {
  const c: InsertContext = { tool, outcome, system, say };
  const svgText = pictureSvg(c);
  return (
    <>
      <section className={styles.section} aria-label={say('kitSolids.ui.results')}>
        <h3 className={styles.heading}>{say('kitSolids.ui.results')}</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{say('kitSolids.ui.quantity')}</th>
              <th scope="col">{say('kitSolids.ui.value')}</th>
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
      </section>
      {outcome.tables?.map((table) => (
        <section key={table.id} className={styles.section}>
          <h3 className={styles.heading}>{say(`kitSolids.${tool}.table.${table.id}`)}</h3>
          <div
            className={styles.scroll}
            tabIndex={0}
            role="region"
            aria-label={say(`kitSolids.${tool}.table.${table.id}`)}
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th key={column} scope="col">
                      {say(`kitSolids.${tool}.col.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((cells, r) => (
                  <tr key={r}>
                    {cells.map((cell, i) => (
                      <td key={i} className={styles.number}>
                        {valueText(cell, system)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {svgText && (
        <figure className={styles.figure}>
          <div role="img" aria-label={say(`kitSolids.${tool}.picture`)} dangerouslySetInnerHTML={{ __html: svgText }} />
        </figure>
      )}
      {outcome.notes && outcome.notes.length > 0 && (
        <section className={styles.section} aria-label={say('kitSolids.ui.assumptions')}>
          <h3 className={styles.heading}>{say('kitSolids.ui.assumptions')}</h3>
          <ul className={styles.notes}>
            {outcome.notes.map((note) => (
              <li key={note}>{say(`kitSolids.${tool}.note.${note}`)}</li>
            ))}
          </ul>
        </section>
      )}
      {outcome.steps.length > 0 && (
        <section className={styles.section} aria-label={say('kitSolids.ui.steps')}>
          <h3 className={styles.heading}>{say('kitSolids.ui.steps')}</h3>
          <ol className={styles.stepList}>
            {outcome.steps.map((one, i) => (
              <li key={i}>
                <span>{say(`kitSolids.step.${one.key}`, wordValues(one.vars, system))}</span>
                {one.math && <Math latex={fillMath(one.math, one.vars, system)} />}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
