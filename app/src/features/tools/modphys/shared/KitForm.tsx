// A calculator form for the modern physics tools: labeled fields in a grid with unit pickers, and a result that
// updates as the person types: the answer, a table of values, a plot, and the worked steps. The result is a status
// region so a screen reader hears it. Insert writes the answer, the equation, the table, the steps, or the plot as
// a picture at the page's caret.
import { useMemo, useState } from 'react';
import './strings';
import { t } from '../../../../strings/t';
import { Button, announce, openMenu } from '../../../../ui';
import { insertIntoPage } from '../../ui/CalculatorTool';
import chem from '../../ui/chem.module.css';
import extra from '../../ui/extra.module.css';
import tools from '../../ui/tools.module.css';
import { describeError } from './describe';
import { parseNumber, unitsOf } from './form';
import type { FieldSpec, Outcome, Values } from './form';
import { Plot } from './PlotView';
import { PRINT, plotTree, svgMarkup } from './plot';

export interface KitFormProps {
  /** Keeps this form's ids apart from other forms in the window. */
  name: string;
  fields: readonly FieldSpec[] | ((values: Values) => readonly FieldSpec[]);
  solve(values: Values): Outcome;
  intro?: string;
}

function firstValues(fields: KitFormProps['fields']): Values {
  const list = typeof fields === 'function' ? fields({ text: {}, unit: {} }) : fields;
  return {
    text: Object.fromEntries(
      list.map((f) => [f.id, f.initial ?? (f.kind === 'select' ? (f.options?.[0]?.value ?? '') : '')]),
    ),
    unit: Object.fromEntries(
      list.filter((f) => unitsOf(f).length > 0).map((f) => [f.id, f.initialUnit ?? unitsOf(f)[0]!]),
    ),
  };
}

function safeSolve(solve: KitFormProps['solve'], values: Values): Outcome {
  try {
    return solve(values);
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}

function insert(outcome: Outcome, part: string): void {
  if (!outcome.ok) return;
  const done = (() => {
    if (part === 'equation' && outcome.latex) return insertIntoPage({ math: { source: outcome.latex, display: true } });
    if (part === 'table' && outcome.rows)
      return insertIntoPage({
        table: {
          header: [t('kitModPhys.form.quantity'), t('kitModPhys.form.value')],
          rows: outcome.rows.map((r) => [r.label, r.value]),
        },
      });
    if (part === 'steps' && outcome.steps)
      return insertIntoPage({
        text: [outcome.answer, ...outcome.steps.map((s) => `- ${s.label}: ${s.text}`)].join('\n'),
      });
    if (part === 'picture' && outcome.plot) {
      const bytes = new TextEncoder().encode(svgMarkup(plotTree(outcome.plot, PRINT))).buffer as ArrayBuffer;
      return insertIntoPage({ picture: { bytes, name: 'plot.svg', alt: outcome.plot.title, mime: 'image/svg+xml' } });
    }
    return insertIntoPage({ text: outcome.answer });
  })();
  announce(t(done ? 'kitModPhys.form.inserted' : 'kitModPhys.form.noPage'));
}

function Field({
  field,
  name,
  values,
  setValues,
}: {
  field: FieldSpec;
  name: string;
  values: Values;
  setValues: (fn: (v: Values) => Values) => void;
}) {
  const id = `modphys-${name}-${field.id}`;
  const value = values.text[field.id] ?? '';
  const units = unitsOf(field);
  const set = (next: string) => setValues((v) => ({ ...v, text: { ...v.text, [field.id]: next } }));
  const invalid = (field.kind ?? 'number') === 'number' && value.trim() !== '' && Number.isNaN(parseNumber(value));
  const control =
    field.kind === 'select' ? (
      <select id={id} className={extra.input} value={value} onChange={(e) => set(e.target.value)}>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    ) : field.kind === 'lines' ? (
      <textarea
        id={id}
        className={extra.input}
        rows={5}
        value={value}
        spellCheck={false}
        aria-describedby={field.help ? `${id}-help` : undefined}
        onChange={(e) => set(e.target.value)}
      />
    ) : (
      <input
        id={id}
        type="text"
        inputMode={field.kind === 'text' ? 'text' : 'decimal'}
        className={extra.input}
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid ? true : undefined}
        aria-describedby={field.help ? `${id}-help` : undefined}
        onChange={(e) => set(e.target.value)}
      />
    );
  return (
    <div className={field.wide || field.kind === 'text' || field.kind === 'lines' ? chem.wide : undefined}>
      <div className={units.length > 0 ? chem.withUnit : undefined}>
        <div className={extra.field}>
          <label htmlFor={id}>{field.label}</label>
          {control}
        </div>
        {units.length > 0 ? (
          <select
            className={extra.input}
            aria-label={t('kitModPhys.form.unitFor', { name: field.label })}
            value={values.unit[field.id] ?? units[0]}
            onChange={(e) => setValues((v) => ({ ...v, unit: { ...v.unit, [field.id]: e.target.value } }))}
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {field.help ? (
        <p id={`${id}-help`} className={tools.note}>
          {field.help}
        </p>
      ) : null}
    </div>
  );
}

function Result({ outcome }: { outcome: Outcome }) {
  if (!outcome.ok)
    return (
      <p className={tools.note} data-modphys-error="">
        {outcome.message}
      </p>
    );
  return (
    <div className={chem.result}>
      <p className={chem.headline}>{outcome.answer}</p>
      {outcome.rows && outcome.rows.length > 0 ? (
        <div className={chem.tableWrap} tabIndex={0} role="region" aria-label={t('kitModPhys.form.values')}>
          <table className={extra.table}>
            <tbody>
              {outcome.rows.map((row, i) => (
                <tr key={i}>
                  <th scope="row">{row.label}</th>
                  <td className={chem.numeric}>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {outcome.plot ? <Plot spec={outcome.plot} /> : null}
      {outcome.steps && outcome.steps.length > 0 ? (
        <ol className={chem.steps} aria-label={t('kitModPhys.form.steps')}>
          {outcome.steps.map((step, i) => (
            <li key={i}>
              {step.label}: {step.text}
            </li>
          ))}
        </ol>
      ) : null}
      {outcome.notes?.map((note, i) => (
        <p key={i} className={chem.source}>
          {note}
        </p>
      ))}
    </div>
  );
}

export function KitForm({ name, fields, solve, intro }: KitFormProps) {
  const [values, setValues] = useState<Values>(() => firstValues(fields));
  const list = typeof fields === 'function' ? fields(values) : fields;
  const outcome = useMemo(() => safeSolve(solve, values), [solve, values]);
  const openMore = (anchor: HTMLButtonElement) => {
    if (!outcome.ok) return;
    const items = [
      { id: 'answer', label: t('kitModPhys.form.insertAnswer') },
      ...(outcome.latex ? [{ id: 'equation', label: t('kitModPhys.form.insertEquation') }] : []),
      ...(outcome.rows?.length ? [{ id: 'table', label: t('kitModPhys.form.insertTable') }] : []),
      ...(outcome.steps?.length ? [{ id: 'steps', label: t('kitModPhys.form.insertSteps') }] : []),
      ...(outcome.plot ? [{ id: 'picture', label: t('kitModPhys.form.insertPicture') }] : []),
    ];
    void openMenu({ label: t('kitModPhys.form.insertMenu'), items, anchor, returnFocus: anchor }).then(
      (chosen) => chosen && insert(outcome, chosen),
    );
  };

  return (
    <div className={tools.tool} data-modphys-form={name}>
      {intro ? <p className={tools.note}>{intro}</p> : null}
      <div className={chem.grid}>
        {list.map((field) => (
          <Field key={field.id} field={field} name={name} values={values} setValues={setValues} />
        ))}
      </div>
      <div role="status" aria-live="polite" data-modphys-answer="">
        <Result outcome={outcome} />
      </div>
      <div className={tools.buttons}>
        <Button variant="primary" disabled={!outcome.ok} onClick={() => insert(outcome, 'answer')}>
          {t('kitModPhys.form.insertAnswer')}
        </Button>
        <Button variant="quiet" disabled={!outcome.ok} aria-haspopup="menu" onClick={(e) => openMore(e.currentTarget)}>
          {t('kitModPhys.form.insertMore')}
        </Button>
      </div>
    </div>
  );
}
