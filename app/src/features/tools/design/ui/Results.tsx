// A tool's outcome in the window: the results table, any further tables, the picture, the assumptions, and the
// worked steps with typeset math. Everything a picture shows is also in the tables and steps, as text.
import '../text';
import { ScrollMath } from '../../ui/ScrollMath';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useMemo } from 'react';
import { numberText } from '../kit/format';
import { PAGE, SCREEN, plotSvg, type Palette } from '../kit/plot';
import { rowLabel, rowText, type InsertContext, type Say } from './insert';
import type { Outcome } from '../kit/spec';
import type { System } from '../kit/units';
import styles from './design.module.css';

/** The SVG text of an outcome's plot, in the given palette; null when it has none. */
export function pictureSvg(c: InsertContext, palette: Palette = SCREEN): string | null {
  const plot = c.outcome.plot;
  if (!plot) return null;
  const base = `kitDesign.${c.tool}.plot.${plot.id}`;
  return plotSvg(plot, { x: c.say(`${base}.x`), y: c.say(`${base}.y`), alt: c.say(`${base}.alt`) }, palette);
}

export const pagePicture = (c: InsertContext): string | null => pictureSvg(c, PAGE);

export function Equation({ latex }: { latex: string }) {
  // The LaTeX is built by the tool from numbers and fixed text, never from what a person typed.
  const html = useMemo(
    () => katex.renderToString(latex, { throwOnError: false, displayMode: true, output: 'htmlAndMathml' }),
    [latex],
  );
  return <ScrollMath as="div" className={styles.math} html={html} />;
}

export function Results(props: { tool: string; outcome: Outcome; system: System; say: Say; units: boolean }) {
  const { tool, outcome, system, say } = props;
  const c: InsertContext = { tool, outcome, system, say };
  const svgText = pictureSvg(c);
  return (
    <>
      <section className={styles.section}>
        <h3 className={styles.heading}>{say('kitDesign.ui.results')}</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{say('kitDesign.ui.quantity')}</th>
              <th scope="col">{say('kitDesign.ui.value')}</th>
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
          <h3 className={styles.heading}>{say(`kitDesign.${tool}.table.${table.id}`)}</h3>
          <div
            className={styles.scroll}
            tabIndex={0}
            role="region"
            aria-label={say(`kitDesign.${tool}.table.${table.id}`)}
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th key={column} scope="col">
                      {say(`kitDesign.${tool}.col.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((cells, r) => (
                  <tr key={r}>
                    {cells.map((cell, i) => (
                      <td key={i} className={styles.number}>
                        {typeof cell === 'number' ? numberText(cell) : cell}
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
          <div dangerouslySetInnerHTML={{ __html: svgText }} />
        </figure>
      )}
      {outcome.notes && outcome.notes.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.heading}>{say('kitDesign.ui.assumptions')}</h3>
          <ul className={styles.notes}>
            {outcome.notes.map((note) => (
              <li key={note}>{say(`kitDesign.${tool}.note.${note}`)}</li>
            ))}
          </ul>
        </section>
      )}
      {outcome.steps.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.heading}>{say('kitDesign.ui.steps')}</h3>
          {props.units && <p className={styles.hint}>{say('kitDesign.ui.stepsUnits')}</p>}
          <ol className={styles.stepList}>
            {outcome.steps.map((one, i) => (
              <li key={i}>
                <span>{say(`kitDesign.step.${one.key}`)}</span>
                <Equation latex={one.latex} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
