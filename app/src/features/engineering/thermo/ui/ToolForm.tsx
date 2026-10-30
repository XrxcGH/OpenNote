// One kit tool: its modes, its fields, and the answer, which updates as the person types. The form is saved on this
// device per tool, so the kit opens where it was left. Problems with the input are said in words in a status line.
import { useEffect, useMemo } from 'react';
import { t } from '../../../../strings/t';
import type { ToolSpec } from '../common/spec';
import type { ThermoResult } from '../common/types';
import type { System } from '../common/units';
import type { ThermoToolId } from '../meta';
import { Field } from './Fields';
import { fieldsOf, textOf, unitOf, valuesOf } from './formState';
import { InsertMenu } from './InsertMenu';
import { Notes, PlotView, ResultTable, StepsView } from './Results';
import { describe, say } from './say';
import { loadForm, saveForm, type SavedForm } from './store';
import styles from './thermo.module.css';

export interface ToolFormProps {
  tool: ThermoToolId;
  spec: ToolSpec;
  system: System;
  form: SavedForm;
  onForm(next: SavedForm): void;
}

/** The saved form of a tool, or a fresh one on its first mode. */
export const firstForm = (tool: ThermoToolId, spec: ToolSpec): SavedForm => {
  const saved = loadForm(tool);
  const mode = spec.modes.some((one) => one.id === saved?.mode) ? saved!.mode : spec.modes[0].id;
  return { mode, text: saved?.text ?? {}, unit: saved?.unit ?? {} };
};

function useSolved(spec: ToolSpec, form: SavedForm, system: System) {
  const mode = spec.modes.find((one) => one.id === form.mode) ?? spec.modes[0];
  const fields = fieldsOf(mode, form, system);
  const { values, invalid, empty } = valuesOf(fields, form, system);
  const key = JSON.stringify(values);
  const outcome = useMemo((): { result: ThermoResult | null; problem: string } => {
    if (invalid.length || empty.length) {
      const first = fields.find((field) => field.id === (empty[0] ?? invalid[0]));
      const name = first ? say(`kitThermo.field.${first.label}`) : '';
      return { result: null, problem: empty.length ? t('kitThermo.error.missing', { name }) : '' };
    }
    try {
      return { result: spec.solve(mode.id, values), problem: '' };
    } catch (error) {
      return { result: null, problem: describe(error) };
    }
  }, [key, mode.id, spec]); // eslint-disable-line react-hooks/exhaustive-deps
  return { mode, fields, invalid, ...outcome };
}

export function ToolForm({ tool, spec, system, form, onForm }: ToolFormProps) {
  const { mode, fields, invalid, result, problem } = useSolved(spec, form, system);
  useEffect(() => saveForm(tool, form), [tool, form]);
  const title = say(`kitThermo.tab.${tool}`);
  return (
    <div className={styles.panel}>
      {spec.modes.length > 1 ? (
        <label className={styles.field}>
          <span>{t('kitThermo.ui.mode')}</span>
          <select
            className={styles.input}
            value={mode.id}
            onChange={(event) => onForm({ ...form, mode: event.target.value })}
          >
            {spec.modes.map((one) => (
              <option key={one.id} value={one.id}>
                {say(`kitThermo.mode.${one.label}`)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className={styles.fields}>
        {fields.map((field) => (
          <Field
            key={`${mode.id}-${field.id}`}
            field={field}
            idPrefix={`thermo-${tool}-${mode.id}`}
            text={textOf(form, field, system)}
            unit={unitOf(form, field, system)}
            system={system}
            invalid={invalid.includes(field.id)}
            onText={(next) => onForm({ ...form, text: { ...form.text, [field.id]: next } })}
            onUnit={(next) => onForm({ ...form, unit: { ...form.unit, [field.id]: next } })}
          />
        ))}
      </div>
      <p className={styles.problem} role="status" aria-live="polite">
        {problem}
      </p>
      {result ? (
        <>
          <ResultTable result={result} system={system} />
          <div className={styles.buttons}>
            <InsertMenu result={result} system={system} title={title} />
          </div>
          <Notes result={result} />
          <PlotView result={result} system={system} />
          <StepsView result={result} />
        </>
      ) : null}
    </div>
  );
}
