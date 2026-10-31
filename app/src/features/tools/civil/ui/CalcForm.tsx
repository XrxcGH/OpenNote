// One calculation of the kit: labeled fields with units, and a result that updates as the person types. The answer
// line is in a status region, so a screen reader hears it; the table, plot, and worked steps follow as text.
import 'katex/dist/katex.min.css';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button, openMenu } from '../../../../ui';
import type { RenderOptions, RenderResult } from '../../../math';
import { loadStored, saveStored } from '../../ui/storage';
import chem from '../../ui/chem.module.css';
import extra from '../../ui/extra.module.css';
import tools from '../../ui/tools.module.css';
import { CivilError } from '../core/types';
import type { Calc, Field, Outcome } from '../core/types';
import { unitsOf } from '../core/units';
import styles from './civil.module.css';
import { CIVIL_RESTORE_EVENT, civilValuesStore } from '../open';
import { cell, insertLive, insertResult, plotText } from './insert';
import type { InsertKind } from './insert';
import { fieldsOf, initialState, parseFields } from './parse';
import type { FieldState } from './parse';
import { plotSvg } from './plot';
import { label, say } from './say';

type Renderer = (latex: string, options: RenderOptions) => RenderResult;
type Solved = { ok: true; outcome: Outcome } | { ok: false; message: string; field?: string };

/** KaTeX is large, so it loads when a result first shows. */
function useRenderer(): Renderer | null {
  const [render, setRender] = useState<Renderer | null>(null);
  useEffect(() => {
    let live = true;
    void import('../../../math').then((math) => live && setRender(() => math.renderLatex));
    return () => {
      live = false;
    };
  }, []);
  return render;
}

function solve(calc: Calc, fields: readonly Field[], state: FieldState): Solved {
  const parsed = parseFields(fields, state);
  if (!parsed.ok)
    return {
      ok: false,
      field: parsed.field,
      message: say({ key: parsed.key, vars: { ...parsed.vars, field: `~${parsed.vars.field}` } }),
    };
  try {
    return { ok: true, outcome: calc.solve(parsed.input) };
  } catch (error) {
    if (error instanceof CivilError) return { ok: false, message: say(error) };
    return { ok: false, message: t('kitCivil.errors.failed') };
  }
}

function UnitPicker({
  id,
  name,
  units,
  value,
  onChange,
}: {
  id: string;
  name: string;
  units: readonly string[];
  value: string;
  onChange(unit: string): void;
}) {
  if (units.length < 2)
    return (
      <span className={styles.unit} id={id}>
        {units[0]}
      </span>
    );
  return (
    <select
      id={id}
      className={extra.input}
      aria-label={t('kitCivil.common.unitFor', { name })}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {units.map((unit) => (
        <option key={unit} value={unit}>
          {unit}
        </option>
      ))}
    </select>
  );
}

interface ControlProps {
  base: string;
  field: Field;
  state: FieldState;
  invalid: boolean;
  setText(id: string, text: string): void;
  setUnit(id: string, unit: string): void;
}

function TableControl({
  base,
  field,
  state,
  invalid,
  setText,
  setUnit,
}: ControlProps & { field: Extract<Field, { kind: 'table' }> }) {
  const id = `${base}-${field.id}`;
  const columns = field.columns.map((c) => label(c.label)).join(', ');
  return (
    <div className={chem.wide}>
      <div className={extra.field}>
        <label htmlFor={id}>{label(field.label)}</label>
        <textarea
          id={id}
          className={`${extra.input} ${styles.table}`}
          rows={Math.min(10, Math.max(3, (state.text[field.id] ?? field.initial).split('\n').length))}
          spellCheck={false}
          value={state.text[field.id] ?? field.initial}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-help`}
          onChange={(e) => setText(field.id, e.target.value)}
        />
      </div>
      <p id={`${id}-help`} className={tools.note}>
        {t('kitCivil.common.columns', { columns })}
        {field.help ? ` ${label(field.help)}` : ''}
      </p>
      <div className={styles.units}>
        {field.columns.map((column, i) =>
          column.quantity && unitsOf(column.quantity).length > 1 ? (
            <UnitPicker
              key={i}
              id={`${id}-u${i}`}
              name={label(column.label)}
              units={unitsOf(column.quantity)}
              value={state.unit[`${field.id}.${i}`] ?? unitsOf(column.quantity)[0]!}
              onChange={(unit) => setUnit(`${field.id}.${i}`, unit)}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}

function FieldControl(props: ControlProps) {
  const { base, field, state, invalid, setText, setUnit } = props;
  if (field.kind === 'table') return <TableControl {...props} field={field} />;
  const id = `${base}-${field.id}`;
  const value = state.text[field.id] ?? field.initial;
  const help = field.help ? (
    <p id={`${id}-help`} className={tools.note}>
      {label(field.help)}
    </p>
  ) : null;
  if (field.kind === 'select')
    return (
      <div className={`${extra.field} ${chem.wide}`}>
        <label htmlFor={id}>{label(field.label)}</label>
        <select
          id={id}
          className={extra.input}
          value={value}
          aria-describedby={field.help ? `${id}-help` : undefined}
          onChange={(e) => setText(field.id, e.target.value)}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {label(option.label)}
            </option>
          ))}
        </select>
        {help}
      </div>
    );
  if (field.kind === 'text')
    return (
      <div className={`${extra.field} ${chem.wide}`}>
        <label htmlFor={id}>{label(field.label)}</label>
        <input
          id={id}
          type="text"
          className={extra.input}
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={field.help ? `${id}-help` : undefined}
          onChange={(e) => setText(field.id, e.target.value)}
        />
        {help}
      </div>
    );
  const units = field.quantity ? unitsOf(field.quantity) : [];
  return (
    <div>
      <div className={units.length ? chem.withUnit : undefined}>
        <div className={extra.field}>
          <label htmlFor={id}>{label(field.label)}</label>
          <input
            id={id}
            type="text"
            inputMode="decimal"
            className={extra.input}
            value={value}
            placeholder={field.optional ? t('kitCivil.common.optional') : undefined}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid || undefined}
            aria-describedby={field.help ? `${id}-help` : undefined}
            onChange={(e) => setText(field.id, e.target.value)}
          />
        </div>
        {units.length ? (
          <UnitPicker
            id={`${id}-unit`}
            name={label(field.label)}
            units={units}
            value={state.unit[field.id] ?? field.unit ?? units[0]!}
            onChange={(unit) => setUnit(field.id, unit)}
          />
        ) : null}
      </div>
      {help}
    </div>
  );
}

function Steps({ outcome }: { outcome: Outcome }) {
  const render = useRenderer();
  return (
    <section aria-label={t('kitCivil.common.steps')}>
      <h3 className={styles.heading}>{t('kitCivil.common.steps')}</h3>
      <ol className={chem.steps}>
        {outcome.steps.map((step, i) => {
          const drawn = step.math && render ? render(step.math, { displayMode: false }) : null;
          return (
            <li key={i}>
              {say(step)}
              {drawn?.ok ? <span className={styles.math} dangerouslySetInnerHTML={{ __html: drawn.html }} /> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Result({ outcome }: { outcome: Outcome }) {
  const svg = useMemo(() => (outcome.plot ? plotSvg(outcome.plot, plotText(outcome.plot)) : null), [outcome.plot]);
  return (
    <div className={styles.result}>
      {outcome.rows.length ? (
        <div className={chem.tableWrap}>
          <table className={extra.table}>
            <caption className={extra.hidden}>{t('kitCivil.common.results')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('kitCivil.common.quantity')}</th>
                <th scope="col" className={chem.numeric}>
                  {t('kitCivil.common.value')}
                </th>
                <th scope="col">{t('kitCivil.common.unit')}</th>
              </tr>
            </thead>
            <tbody>
              {outcome.rows.map((row, i) => (
                <tr key={i}>
                  <th scope="row">{label(row.label)}</th>
                  <td className={chem.numeric}>{cell(row.value)}</td>
                  <td>{row.unit ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {svg ? <figure className={chem.figure} dangerouslySetInnerHTML={{ __html: svg }} /> : null}
      {outcome.grid ? (
        <div className={chem.tableWrap}>
          <table className={extra.table}>
            <caption className={styles.caption}>{label(outcome.grid.caption)}</caption>
            <thead>
              <tr>
                {outcome.grid.header.map((h) => (
                  <th key={h} scope="col">
                    {label(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {outcome.grid.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((value, c) => (
                    <td key={c} className={typeof value === 'number' ? chem.numeric : undefined}>
                      {cell(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {outcome.steps.length ? <Steps outcome={outcome} /> : null}
      {outcome.notes?.length ? (
        <ul className={styles.notes}>
          {outcome.notes.map((note, i) => (
            <li key={i}>{say(note)}</li>
          ))}
        </ul>
      ) : null}
      {outcome.source ? (
        <p className={chem.source}>{t('kitCivil.common.source', { source: label(outcome.source) })}</p>
      ) : null}
    </div>
  );
}

function InsertBar({ outcome, live }: { outcome: Outcome | null; live: (outcome: Outcome) => void }) {
  const run = (kind: InsertKind) => outcome && void insertResult(outcome, kind);
  const openMore = (anchor: HTMLElement) => {
    if (!outcome) return;
    const item = (id: InsertKind, key: Parameters<typeof t>[0], disabled = false) => ({
      id,
      label: t(key),
      disabled,
      onSelect: () => run(id),
    });
    void openMenu({
      label: t('kitCivil.common.insertMore'),
      anchor,
      items: [
        item('steps', 'kitCivil.common.insertSteps', outcome.steps.length === 0),
        item('table', 'kitCivil.common.insertTable', outcome.rows.length === 0),
        item('latex', 'kitCivil.common.insertLatex', !outcome.latex),
        item('grid', 'kitCivil.common.insertGrid', !outcome.grid),
        item('picture', 'kitCivil.common.insertPicture', !outcome.plot),
        { id: 'live', label: t('kitCivil.common.insertLive'), onSelect: () => live(outcome) },
      ],
    });
  };
  return (
    <div className={tools.buttons}>
      <Button variant="primary" disabled={!outcome} onClick={() => run('answer')}>
        {t('kitCivil.common.insertAnswer')}
      </Button>
      <Button variant="quiet" disabled={!outcome} aria-haspopup="menu" onClick={(e) => openMore(e.currentTarget)}>
        {t('kitCivil.common.insertMore')}
      </Button>
    </div>
  );
}

function readState(calc: Calc, store: string): FieldState {
  const first = initialState(calc);
  const kept = loadStored<Partial<FieldState>>(store, {});
  return { text: { ...first.text, ...kept.text }, unit: { ...first.unit, ...kept.unit } };
}

export function CalcForm({ tool, calc }: { tool: string; calc: Calc }) {
  const store = civilValuesStore(tool, calc.id);
  const [state, setState] = useState<FieldState>(() => readState(calc, store));
  // A live block's Open in tool saves its inputs and asks an open form on the same calculation to read them again.
  useEffect(() => {
    const restore = (event: Event) => {
      if ((event as CustomEvent<string>).detail === store) setState(readState(calc, store));
    };
    window.addEventListener(CIVIL_RESTORE_EVENT, restore);
    return () => window.removeEventListener(CIVIL_RESTORE_EVENT, restore);
  }, [calc, store]);
  const deferred = useDeferredValue(state);
  const fields = fieldsOf(calc, state);
  const solved = useMemo(() => solve(calc, fieldsOf(calc, deferred), deferred), [calc, deferred]);
  const update = (next: FieldState) => {
    setState(next);
    saveStored(store, next);
  };
  const setText = (id: string, text: string) => update({ ...state, text: { ...state.text, [id]: text } });
  const setUnit = (id: string, unit: string) => update({ ...state, unit: { ...state.unit, [id]: unit } });
  const base = `civil-${tool}-${calc.id}`;
  return (
    <div className={tools.tool} data-civil-calc={calc.id}>
      {calc.intro ? <p className={tools.note}>{label(calc.intro)}</p> : null}
      <div className={chem.grid}>
        {fields.map((field) => (
          <FieldControl
            key={field.id}
            base={base}
            field={field}
            state={state}
            invalid={!solved.ok && solved.field === field.id}
            setText={setText}
            setUnit={setUnit}
          />
        ))}
      </div>
      <div role="status" aria-live="polite" data-civil-answer="" className={styles.answer}>
        <p className={solved.ok ? chem.headline : tools.note}>
          {solved.ok ? say(solved.outcome.answer) : solved.message}
        </p>
      </div>
      {solved.ok ? <Result outcome={solved.outcome} /> : null}
      <InsertBar
        outcome={solved.ok ? solved.outcome : null}
        live={(outcome) => void insertLive(outcome, { tool, calc: calc.id, title: label(calc.title), state })}
      />
    </div>
  );
}
