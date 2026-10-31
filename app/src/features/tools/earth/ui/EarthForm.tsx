// One earth kit calculation: labeled fields in a grid, and an answer that updates as the person types, with its
// table, pictures, and worked steps under it. The answer sits in a status region so a screen reader hears it.
// Insert writes the answer, the equation, the table, the steps, or a picture at the page's caret.
import { useDeferredValue, useMemo, useState } from 'react';
import { t } from '../../../../strings/t';
import { unitIds } from '../core/units';
import type { EarthToolId } from '../meta';
import extra from '../../ui/extra.module.css';
import { FigureView } from './FigureView';
import { initialValues, run } from './form';
import type { Field, Mode, Outcome, Values } from './form';
import { InsertControls } from './InsertControls';
import styles from './earth.module.css';

function FieldControl({ id, field, values, setValues }: FieldProps & { id: string }) {
  const value = values.text[field.id] ?? '';
  const set = (next: string) => setValues((v) => ({ ...v, text: { ...v.text, [field.id]: next } }));
  const described = field.help ? `${id}-help` : undefined;
  if (field.kind === 'select')
    return (
      <select id={id} className={extra.input} value={value} onChange={(e) => set(e.target.value)}>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.label)}
          </option>
        ))}
      </select>
    );
  if (field.kind === 'area')
    return (
      <textarea
        id={id}
        className={`${extra.input} ${styles.area}`}
        rows={field.rows ?? 6}
        value={value}
        spellCheck={false}
        aria-describedby={described}
        onChange={(e) => set(e.target.value)}
      />
    );
  return (
    <input
      id={id}
      type="text"
      inputMode={field.kind === 'text' ? 'text' : 'decimal'}
      className={extra.input}
      value={value}
      spellCheck={false}
      autoComplete="off"
      aria-describedby={described}
      onChange={(e) => set(e.target.value)}
    />
  );
}

interface FieldProps {
  field: Field;
  values: Values;
  setValues: (update: (v: Values) => Values) => void;
}

function FieldRow({ field, values, setValues, name }: FieldProps & { name: string }) {
  const id = `earth-${name}-${field.id}`;
  const label = t(field.label);
  const wide = field.kind === 'area' || field.kind === 'text';
  return (
    <div className={wide ? styles.wide : undefined}>
      <div className={field.quantity ? styles.withUnit : undefined}>
        <div className={extra.field}>
          <label htmlFor={id}>{label}</label>
          <FieldControl id={id} field={field} values={values} setValues={setValues} />
        </div>
        {field.quantity ? (
          <select
            className={extra.input}
            aria-label={t('kitEarth.unitFor', { name: label })}
            value={values.unit[field.id]}
            onChange={(e) => setValues((v) => ({ ...v, unit: { ...v.unit, [field.id]: e.target.value } }))}
          >
            {unitIds(field.quantity).map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {field.help ? (
        <p id={`${id}-help`} className={styles.note}>
          {t(field.help)}
        </p>
      ) : null}
    </div>
  );
}

function Table({ header, rows }: { header?: readonly string[]; rows: readonly (readonly string[])[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        {header ? (
          <thead>
            <tr>
              {header.map((h, i) => (
                <th key={i} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) =>
                j === 0 && !header ? (
                  <th key={j} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={j}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutcomeView({ outcome }: { outcome: Outcome }) {
  return (
    <>
      {outcome.table ? <Table header={outcome.table.header} rows={outcome.table.rows} /> : null}
      {outcome.figures?.map((figure, i) => (
        <FigureView key={i} figure={figure} />
      ))}
      {outcome.steps?.length ? (
        <ol className={styles.steps} aria-label={t('kitEarth.steps')}>
          {outcome.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      ) : null}
      {outcome.source ? <p className={styles.source}>{t('kitEarth.source', { source: outcome.source })}</p> : null}
    </>
  );
}

export function EarthForm({ tool, mode }: { tool: EarthToolId; mode: Mode }) {
  const [values, setValues] = useState<Values>(() => initialValues(mode));
  const deferred = useDeferredValue(values);
  const result = useMemo(() => run(tool, mode, deferred), [tool, mode, deferred]);
  const text = (id: string) => values.text[id] ?? '';
  const name = `${tool}-${mode.id}`;
  return (
    <div className={styles.kit} data-earth-form={name}>
      {mode.intro ? <p className={styles.note}>{t(mode.intro)}</p> : null}
      <div className={styles.grid}>
        {mode.fields
          .filter((f) => !f.show || f.show(text))
          .map((field) => (
            <FieldRow key={field.id} field={field} values={values} setValues={setValues} name={name} />
          ))}
      </div>
      <div role="status" aria-live="polite" data-earth-answer="">
        {result.ok ? (
          <div className={styles.result}>
            <p className={styles.answer}>{result.outcome.answer}</p>
            {result.outcome.rows?.length ? <Table rows={result.outcome.rows} /> : null}
            {result.outcome.note ? <p className={styles.note}>{result.outcome.note}</p> : null}
          </div>
        ) : (
          <p className={styles.problem}>{result.message}</p>
        )}
      </div>
      {result.ok ? <OutcomeView outcome={result.outcome} /> : null}
      <InsertControls outcome={result.ok ? result.outcome : null} />
    </div>
  );
}
