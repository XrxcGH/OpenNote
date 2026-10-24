// The answer of a tool: the result rows, the tables, the plot, the working with its equations, the assumptions, and
// the sources. The rows are in a status region so a screen reader hears a changed answer.
import { useMemo } from 'react';
import type { MessageKey } from '../../../../strings/t';
import chem from '../../ui/chem.module.css';
import extra from '../../ui/extra.module.css';
import tools from '../../ui/tools.module.css';
import { plotSvg } from '../plot';
import type { Outcome, Solved } from '../types';
import type { System } from '../units';
import own from './chemmat.module.css';
import { plotText } from './InsertBar';
import { MathLine } from './MathLine';
import { showRow, tr } from './text';

const text = (s: string) => (s.startsWith('kitChemMat.') ? tr(s as MessageKey) : s);

function ResultRows({ solved, system }: { solved: Solved; system: System }) {
  return (
    <div className={chem.result}>
      <table className={own.rows}>
        <tbody>
          {solved.rows.map((row, i) => {
            const s = showRow(row, system);
            return (
              <tr key={i}>
                <th scope="row">{s.label}</th>
                <td className={chem.numeric}>{s.value}</td>
                <td>{s.unit}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExtraTables({ tables }: { tables: NonNullable<Solved['tables']> }) {
  return (
    <>
      {tables.map((table, i) => (
        <div key={i}>
          <h3 className={own.heading}>{tr(table.title)}</h3>
          <div className={chem.tableWrap}>
            <table className={extra.table}>
              <thead>
                <tr>
                  {table.header.map((h, c) => (
                    <th key={c} scope="col">
                      {text(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((cells, r) => (
                  <tr key={r}>
                    {cells.map((cell, c) => (
                      <td key={c} className={c > 0 ? chem.numeric : undefined}>
                        {text(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

function PlotFigure({ solved }: { solved: Solved }) {
  const svg = useMemo(() => (solved.plot ? plotSvg(solved.plot, plotText(solved), true) : ''), [solved]);
  if (!svg) return null;
  return (
    <figure className={chem.figure} role="img" aria-label={tr(solved.plot!.alt)}>
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </figure>
  );
}

function Working({ solved }: { solved: Solved }) {
  return (
    <>
      <h3 className={own.heading}>{tr('kitChemMat.common.steps')}</h3>
      <ol className={chem.steps}>
        {solved.steps.map((step, i) => (
          <li key={i}>
            {tr(step.key, step.vars)}
            {step.math ? (
              <div>
                <MathLine latex={step.math} display />
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {solved.notes.length > 0 ? (
        <>
          <h3 className={own.heading}>{tr('kitChemMat.common.assumptions')}</h3>
          <ul className={own.notes}>
            {solved.notes.map((n, i) => (
              <li key={i}>{tr(n.key, n.vars)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {solved.sources && solved.sources.length > 0 ? (
        <p className={chem.source}>{tr('kitChemMat.common.source', { sources: solved.sources.join('; ') })}</p>
      ) : null}
    </>
  );
}

export function Results({ outcome, system }: { outcome: Outcome; system: System }) {
  return (
    <>
      <div role="status" aria-live="polite" data-chemmat-answer="">
        {outcome.ok ? (
          <ResultRows solved={outcome} system={system} />
        ) : (
          <p className={tools.note}>{tr(outcome.key, outcome.vars)}</p>
        )}
      </div>
      {outcome.ok ? (
        <>
          {outcome.tables ? <ExtraTables tables={outcome.tables} /> : null}
          <PlotFigure solved={outcome} />
          <Working solved={outcome} />
        </>
      ) : null}
    </>
  );
}
