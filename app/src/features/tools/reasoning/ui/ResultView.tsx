// A kit answer: the result in a status region, the worked steps, the picture, and the tables, with Insert buttons
// that write any of them at the caret of the open page. Long tables show their first rows and say how many there are.
import { Button, announce } from '../../../../ui';
import { insertIntoPage } from './insert';
import { svgFile } from '../core/svg';
import { say } from './say';
import { SvgView } from './SvgView';
import type { Outcome, Table } from './types';
import styles from './reasoning.module.css';

const SHOWN_ROWS = 300;
const INSERTED_ROWS = 1024;

function TableView({ table }: { table: Table }) {
  const shown = table.rows.slice(0, SHOWN_ROWS);
  return (
    // The wrapper scrolls, so it takes focus and the arrow keys can scroll it.
    <div className={styles.tableWrap} role="region" aria-label={table.caption} tabIndex={0}>
      <table className={styles.table}>
        <caption>{table.caption}</caption>
        <thead>
          <tr>
            {table.header.map((h, i) =>
              h === '' ? (
                <td key={i} />
              ) : (
                <th key={i} scope="col">
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length > SHOWN_ROWS ? (
        <p className={styles.note}>{say('common.moreRows', { shown: SHOWN_ROWS, total: table.rows.length })}</p>
      ) : null}
    </div>
  );
}

type Shown = Extract<Outcome, { ok: true }>;

function insert(detail: Parameters<typeof insertIntoPage>[0]) {
  announce(say(insertIntoPage(detail) ? 'common.inserted' : 'common.noPage'));
}

function InsertBar({ outcome }: { outcome: Shown }) {
  const steps = outcome.steps ?? [];
  const table = outcome.tables?.[0];
  const figure = outcome.figure;
  return (
    <div className={styles.insert} role="group" aria-label={say('common.insertGroup')}>
      <Button variant="quiet" onClick={() => insert({ text: outcome.answer })}>
        {say('common.insertAnswer')}
      </Button>
      {steps.length ? (
        <Button
          variant="quiet"
          onClick={() => insert({ text: [outcome.answer, ...steps.map((s, i) => `${i + 1}. ${s}`)].join('\n') })}
        >
          {say('common.insertSteps')}
        </Button>
      ) : null}
      {outcome.latex ? (
        <Button variant="quiet" onClick={() => insert({ math: { source: outcome.latex!, display: true } })}>
          {say('common.insertLatex')}
        </Button>
      ) : null}
      {table ? (
        <Button
          variant="quiet"
          onClick={() =>
            insert({
              table: { header: [...table.header], rows: table.rows.slice(0, INSERTED_ROWS).map((r) => [...r]) },
            })
          }
        >
          {say('common.insertTable')}
        </Button>
      ) : null}
      {figure ? (
        <Button
          variant="quiet"
          onClick={() => {
            const bytes = new TextEncoder().encode(svgFile(figure.svg, figure.alt));
            const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            insert({ picture: { bytes: buffer, name: 'figure.svg', alt: figure.alt, mime: 'image/svg+xml' } });
          }}
        >
          {say('common.insertPicture')}
        </Button>
      ) : null}
    </div>
  );
}

export function ResultView({ outcome }: { outcome: Outcome }) {
  return (
    <div className={styles.result} role="status" aria-live="polite" data-kit-answer="">
      {outcome.ok ? (
        <>
          <p className={styles.answer}>{outcome.answer}</p>
          {outcome.note ? <p className={styles.note}>{outcome.note}</p> : null}
          {outcome.steps?.length ? (
            <ol className={styles.steps} aria-label={say('common.steps')}>
              {outcome.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          ) : null}
        </>
      ) : (
        <p className={styles.problem}>{outcome.message}</p>
      )}
    </div>
  );
}

/** What follows the answer: the picture, the tables, and Insert. Outside the status region, so it is not read out. */
export function ResultDetails({ outcome }: { outcome: Outcome }) {
  if (!outcome.ok) return null;
  return (
    <>
      {outcome.figure ? <SvgView svg={outcome.figure.svg} alt={outcome.figure.alt} /> : null}
      {outcome.tables?.map((table, i) => (
        <TableView key={i} table={table} />
      ))}
      <InsertBar outcome={outcome} />
    </>
  );
}
