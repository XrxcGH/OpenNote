// The programming references tool: searchable cards for the C++ types, escape sequences, common errors, and MATLAB
// habits, the operator precedence table with a check for which of two operators binds first, and a blank trace table
// to fill in by hand while reading code. Everything shown is plain text, so it reads in a screen reader and inserts as
// a table.
import { useId, useMemo, useState } from 'react';
import { Button, announce } from '../../../../ui';
import {
  ALL_CARDS,
  PRECEDENCE,
  groupsFirst,
  searchCards,
  traceTable,
  traceVariables,
  type RefGroup,
} from '../referenceData';
import { sendToPage } from './insert';
import { say } from './ToolPanel';
import { load, save } from './store';
import styles from './design.module.css';

const GROUPS: readonly (RefGroup | 'all')[] = ['all', 'types', 'escapes', 'errors', 'matlab'];
const OPERATORS = PRECEDENCE.flatMap((row) => row.ops).filter((op) => !/[a-z]/.test(op));

function Cards() {
  const searchId = useId();
  const [query, setQuery] = useState(() => load('references.query', ''));
  const [group, setGroup] = useState<RefGroup | 'all'>(() => {
    const saved = load<string>('references.group', 'all');
    return (GROUPS as readonly string[]).includes(saved) ? (saved as RefGroup | 'all') : 'all';
  });
  const shown = useMemo(
    () => searchCards(group === 'all' ? ALL_CARDS : ALL_CARDS.filter((card) => card.group === group), query),
    [group, query],
  );
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{say('kitDesign.references.cards')}</h3>
      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor={searchId}>{say('kitDesign.references.search')}</label>
          <input
            id={searchId}
            type="search"
            className={styles.input}
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              save('references.query', event.target.value);
            }}
          />
        </div>
        <label className={styles.field}>
          <span>{say('kitDesign.references.group')}</span>
          <select
            className={styles.input}
            value={group}
            onChange={(event) => {
              setGroup(event.target.value as RefGroup | 'all');
              save('references.group', event.target.value);
            }}
          >
            {GROUPS.map((one) => (
              <option key={one} value={one}>
                {say(`kitDesign.references.groups.${one}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={styles.hint} role="status">
        {shown.length === 0
          ? say('kitDesign.references.none')
          : say('kitDesign.references.count', { count: shown.length })}
      </p>
      <div className={styles.cards}>
        {shown.map((card) => (
          <article key={card.id} className={styles.card}>
            <h4 className={styles.heading}>{card.title}</h4>
            <p className={styles.cardBody}>{card.body}</p>
            {card.code && <pre className={`${styles.mono} ${styles.code}`}>{card.code}</pre>}
          </article>
        ))}
      </div>
    </section>
  );
}

function Precedence() {
  const [first, setFirst] = useState('+');
  const [second, setSecond] = useState('*');
  const verdict = groupsFirst(first, second);
  const sentence =
    verdict === null
      ? say('kitDesign.references.unlisted')
      : say(`kitDesign.references.verdict.${verdict === 'first' || verdict === 'second' ? verdict : 'tie'}`, {
          first,
          second,
          order: say(`kitDesign.references.order.${verdict === 'right-to-left' ? 'right' : 'left'}`),
        });
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{say('kitDesign.references.precedence')}</h3>
      <p className={styles.hint}>{say('kitDesign.references.precedenceAbout')}</p>
      <div className={styles.row}>
        {[
          ['first', first, setFirst],
          ['second', second, setSecond],
        ].map(([id, value, set]) => (
          <label key={id as string} className={styles.field}>
            <span>{say(`kitDesign.references.${id as string}Operator`)}</span>
            <select
              className={styles.input}
              value={value as string}
              onChange={(event) => (set as (v: string) => void)(event.target.value)}
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <p role="status">{sentence}</p>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label={say('kitDesign.references.precedence')}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{say('kitDesign.references.rank')}</th>
              <th scope="col">{say('kitDesign.references.operators')}</th>
              <th scope="col">{say('kitDesign.references.assocColumn')}</th>
              <th scope="col">{say('kitDesign.references.meaning')}</th>
            </tr>
          </thead>
          <tbody>
            {PRECEDENCE.map((row) => (
              <tr key={row.rank}>
                <td className={styles.number}>{row.rank}</td>
                <td className={styles.number}>{row.ops.join('  ')}</td>
                <td>{say(`kitDesign.references.assoc.${row.assoc}`)}</td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Trace() {
  const varsId = useId();
  const rowsId = useId();
  const [vars, setVars] = useState(() => load('references.vars', 'i sum'));
  const [rows, setRows] = useState(() => load('references.rows', '6'));
  const names = traceVariables(vars);
  const count = Number(rows);
  const bad = !Number.isInteger(count) || count < 1 || count > 60;
  const table = useMemo(
    () =>
      names.length === 0 || bad
        ? null
        : traceTable(names, count, {
            line: say('kitDesign.references.line'),
            output: say('kitDesign.references.output'),
          }),
    // The names are rebuilt from the text each render, so the text is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vars, count, bad],
  );
  const insert = () => {
    if (!table) return;
    const took = sendToPage({ table });
    announce(say(took ? 'kitDesign.ui.inserted' : 'kitDesign.ui.noPage'));
  };
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{say('kitDesign.references.trace')}</h3>
      <p className={styles.hint}>{say('kitDesign.references.traceAbout')}</p>
      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor={varsId}>{say('kitDesign.references.variables')}</label>
          <input
            id={varsId}
            type="text"
            className={styles.input}
            value={vars}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setVars(event.target.value);
              save('references.vars', event.target.value);
            }}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={rowsId}>{say('kitDesign.references.traceRows')}</label>
          <input
            id={rowsId}
            type="text"
            inputMode="numeric"
            className={styles.input}
            value={rows}
            aria-invalid={bad ? true : undefined}
            onChange={(event) => {
              setRows(event.target.value);
              save('references.rows', event.target.value);
            }}
          />
        </div>
      </div>
      {bad && <p className={styles.problem}>{say('kitDesign.references.rowsRange')}</p>}
      {table && (
        <>
          <div className={styles.buttons}>
            <Button variant="primary" onClick={insert}>
              {say('kitDesign.references.insertTable')}
            </Button>
          </div>
          <div className={styles.scroll} tabIndex={0} role="region" aria-label={say('kitDesign.references.trace')}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {table.header.map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((cells, r) => (
                  <tr key={r}>
                    {cells.map((_, c) => (
                      <td key={c}>&nbsp;</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export default function ReferencesTool() {
  return (
    <div className={styles.panel}>
      <p className={styles.hint}>{say('kitDesign.references.about')}</p>
      <Cards />
      <Precedence />
      <Trace />
    </div>
  );
}
