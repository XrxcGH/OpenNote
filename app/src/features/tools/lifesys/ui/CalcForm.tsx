// One life-systems calculation: labeled fields, the result as a small table in a status region (so a screen reader
// hears it), notes and the source, plots, a data table, and the worked steps. Insert puts the answer, the steps,
// the equation, the table, or a picture of the plot at the page's caret. A simulation runs when Run is pressed.
import { useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { Button, announce, openMenu } from '../../../../ui';
import { loadStored, saveStored } from '../../ui/storage';
import type { CalcResult, CalcSpec, FieldSpec } from '../types';
import { Field } from './fields';
import type { Values } from './fields';
import { answerText, liveBlock, plotPicture, resultTable, rowValue, send, stepsLatex, stepsText } from './insert';
import styles from './lifesys.module.css';
import { Plot } from './Plot';
import { initialValues, makeReader } from './reader';
import { word, problem } from './words';

type Outcome = { ok: true; result: CalcResult } | { ok: false; message: string } | null;

function fieldsOf(spec: CalcSpec, values: Values): readonly FieldSpec[] {
  return typeof spec.fields === 'function' ? spec.fields((id) => values.text[id] ?? '') : spec.fields;
}

function startValues(spec: CalcSpec, store: string): Values {
  const saved = loadStored<Values | null>(store, null);
  const first = initialValues(fieldsOf(spec, { text: {}, unit: {} }));
  const base = { text: { ...first.text, ...saved?.text }, unit: { ...first.unit, ...saved?.unit } };
  const second = initialValues(fieldsOf(spec, base));
  return { text: { ...second.text, ...base.text }, unit: { ...second.unit, ...base.unit } };
}

function solve(spec: CalcSpec, fields: readonly FieldSpec[], values: Values): Outcome {
  try {
    return { ok: true, result: spec.solve(makeReader(fields, values)) };
  } catch (error) {
    return { ok: false, message: problem(error) };
  }
}

interface InsertFrom {
  tool: string;
  spec: CalcSpec;
  values: Values;
}

async function chooseInsert(event: MouseEvent<HTMLButtonElement>, result: CalcResult, from: InsertFrom): Promise<void> {
  const latex = stepsLatex(result);
  const plots = result.plots ?? [];
  const items = [
    { id: 'answer', label: word('ui.insertAnswer') },
    { id: 'steps', label: word('ui.insertSteps') },
    ...(latex ? [{ id: 'latex', label: word('ui.insertLatex') }] : []),
    { id: 'table', label: word('ui.insertTable') },
    { id: 'live', label: word('ui.insertLive') },
    ...plots.map((plot, i) => ({
      id: `plot${i}`,
      label: word('ui.insertPlot', { title: word(plot.title, plot.vars) }),
    })),
  ];
  const chosen = await openMenu({ label: word('ui.insertMenu'), items, anchor: event.currentTarget });
  if (chosen === 'answer') send({ text: answerText(result) });
  else if (chosen === 'steps') send({ text: stepsText(result) });
  else if (chosen === 'latex' && latex) send({ math: { source: latex, display: true } });
  else if (chosen === 'table') send({ table: resultTable(result) });
  else if (chosen === 'live') send({ panel: liveBlock(from.tool, from.spec, from.values, result) });
  else if (chosen?.startsWith('plot')) {
    const picture = await plotPicture(plots[Number(chosen.slice(4))]);
    if (picture) send({ picture });
    else announce(word('ui.noPicture'));
  }
}

function ResultView({ result }: { result: CalcResult }) {
  const table = result.table ? resultTable(result) : null;
  return (
    <>
      {result.plots?.map((plot, i) => (
        <Plot key={i} plot={plot} />
      ))}
      {table ? (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={word('ui.dataTable')}>
          <table className={styles.table}>
            <thead>
              <tr>
                {table.header.map((h, i) => (
                  <th key={i} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {result.steps.length > 0 ? (
        <>
          <h3 className={styles.subhead}>{word('ui.steps')}</h3>
          <ol className={styles.steps}>
            {result.steps.map((step, i) => (
              <li key={i}>{word(step.key, step.vars)}</li>
            ))}
          </ol>
        </>
      ) : null}
    </>
  );
}

function Answer({ result }: { result: CalcResult }) {
  return (
    <div className={styles.result}>
      <table className={styles.table}>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>
              <th scope="row">{word(row.label, row.vars)}</th>
              <td className={styles.number}>
                {rowValue(row)}
                {row.unit ? ` ${row.unit}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.notes?.map((note, i) => (
        <p key={i} className={styles.note}>
          {word(note.key, note.vars)}
        </p>
      ))}
      {result.source ? <p className={styles.note}>{word('ui.sourceLine', { source: word(result.source) })}</p> : null}
    </div>
  );
}

export function CalcForm({ tool, spec, store }: { tool: string; spec: CalcSpec; store: string }) {
  const [typed, setValues] = useState<Values>(() => startValues(spec, store));
  const [ran, setRan] = useState<Values | null>(null);
  // Fields that appear after a choice changes start from their initial values.
  const { fields, values } = useMemo(() => {
    const list = fieldsOf(spec, typed);
    const first = initialValues(list);
    return { fields: list, values: { text: { ...first.text, ...typed.text }, unit: { ...first.unit, ...typed.unit } } };
  }, [spec, typed]);
  const live = useMemo(() => (spec.manual ? null : solve(spec, fields, values)), [spec, fields, values]);
  const outcome = spec.manual ? (ran ? solve(spec, fieldsOf(spec, ran), ran) : null) : live;
  const update = (next: Values) => {
    setValues(next);
    saveStored(store, next);
  };
  const idBase = `ls-${store.replace(/\W/g, '-')}`;
  return (
    <div className={styles.tool} data-ls-calc={spec.id}>
      {spec.intro ? <p className={styles.note}>{word(spec.intro)}</p> : null}
      <div className={styles.grid}>
        {fields.map((field) => (
          <Field
            key={field.id}
            field={field}
            idBase={idBase}
            values={values}
            setText={(id, value) => update({ ...values, text: { ...values.text, [id]: value } })}
            setUnit={(id, value) => update({ ...values, unit: { ...values.unit, [id]: value } })}
          />
        ))}
      </div>
      {spec.manual ? (
        <div className={styles.buttons}>
          <Button variant="primary" onClick={() => setRan(values)}>
            {word('ui.run')}
          </Button>
        </div>
      ) : null}
      <div role="status" aria-live="polite" data-ls-answer="">
        {outcome === null ? (
          <p className={styles.note}>{word('ui.pressRun')}</p>
        ) : outcome.ok ? (
          <Answer result={outcome.result} />
        ) : (
          <p className={styles.note}>{outcome.message}</p>
        )}
      </div>
      {outcome?.ok ? <ResultView result={outcome.result} /> : null}
      <div className={styles.buttons}>
        <Button
          variant={spec.manual ? 'secondary' : 'primary'}
          disabled={!outcome?.ok}
          aria-haspopup="menu"
          onClick={(event) =>
            outcome?.ok && void chooseInsert(event, outcome.result, { tool, spec, values: ran ?? values })
          }
        >
          {word('ui.insert')}
        </Button>
      </div>
    </div>
  );
}
