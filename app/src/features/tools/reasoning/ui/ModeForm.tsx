// One mode of a reasoning tool: labeled fields, then the answer, which follows what is typed. The answer is worked
// out from a deferred copy of the fields, so typing stays smooth while a large table is built.
import { useDeferredValue, useMemo, useState } from 'react';
import { loadStored, saveStored } from '../../ui/storage';
import { ResultDetails, ResultView } from './ResultView';
import { say } from './say';
import type { Field, Mode, Outcome, Values } from './types';
import styles from './reasoning.module.css';

const fieldsOf = (mode: Mode, values: Values): readonly Field[] =>
  typeof mode.fields === 'function' ? mode.fields(values) : mode.fields;

const firstValue = (f: Field): string => f.initial ?? (f.kind === 'select' ? (f.options?.[0] ?? '') : '');

function initialValues(mode: Mode): Record<string, string> {
  return Object.fromEntries(fieldsOf(mode, {}).map((f) => [f.id, firstValue(f)]));
}

/** The values with a first value for each field the person has not typed in, such as one a select just added. */
function withDefaults(mode: Mode, values: Values): Values {
  const filled: Record<string, string> = { ...values };
  for (const f of fieldsOf(mode, values)) if (filled[f.id] === undefined) filled[f.id] = firstValue(f);
  return filled;
}

function solveSafely(mode: Mode, values: Values): Outcome {
  try {
    return mode.solve(withDefaults(mode, values));
  } catch {
    return { ok: false, message: say('common.failed') };
  }
}

function Control({
  tool,
  field,
  id,
  value,
  set,
}: {
  tool: string;
  field: Field;
  id: string;
  value: string;
  set(v: string): void;
}) {
  const help = field.help ? `${id}-help` : undefined;
  if (field.kind === 'select')
    return (
      <select
        id={id}
        className={styles.input}
        value={value}
        aria-describedby={help}
        onChange={(e) => set(e.target.value)}
      >
        {field.options?.map((o) => (
          <option key={o} value={o}>
            {say(`${tool}.options.${field.id}.${o}`)}
          </option>
        ))}
      </select>
    );
  if (field.kind === 'area')
    return (
      <textarea
        id={id}
        className={`${styles.input} ${styles.area}`}
        rows={field.rows ?? 4}
        value={value}
        spellCheck={false}
        aria-describedby={help}
        onChange={(e) => set(e.target.value)}
      />
    );
  return (
    <input
      id={id}
      type="text"
      className={styles.input}
      value={value}
      spellCheck={false}
      autoComplete="off"
      aria-describedby={help}
      onChange={(e) => set(e.target.value)}
    />
  );
}

export function ModeForm({ tool, mode }: { tool: string; mode: Mode }) {
  const store = `kit-reasoning.${tool}.${mode.id}`;
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...initialValues(mode),
    ...loadStored<Record<string, string>>(store, {}),
  }));
  const deferred = useDeferredValue(values);
  const outcome = useMemo(() => solveSafely(mode, deferred), [mode, deferred]);
  const fields = fieldsOf(mode, values);
  const set = (fieldId: string, next: string) =>
    setValues((current) => {
      const updated = { ...current, [fieldId]: next };
      saveStored(store, updated);
      return updated;
    });
  const reset = () => {
    const first = initialValues(mode);
    saveStored(store, first);
    setValues(first);
  };

  return (
    <div className={styles.mode} data-kit-mode={`${tool}.${mode.id}`}>
      <p className={styles.note}>{say(`${tool}.modes.${mode.id}.intro`)}</p>
      <div className={styles.grid}>
        {fields.map((field) => {
          const id = `kit-${tool}-${mode.id}-${field.id}`;
          return (
            <div key={field.id} className={`${styles.field} ${field.kind === 'area' || field.wide ? styles.wide : ''}`}>
              <label htmlFor={id}>{say(`${tool}.fields.${field.id}`)}</label>
              <Control
                tool={tool}
                field={field}
                id={id}
                value={values[field.id] ?? firstValue(field)}
                set={(next) => set(field.id, next)}
              />
              {field.help ? (
                <p id={`${id}-help`} className={styles.note}>
                  {say(`${tool}.help.${field.id}`)}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.linkButton} onClick={reset}>
          {say('common.example')}
        </button>
      </div>
      <ResultView outcome={outcome} />
      <ResultDetails outcome={outcome} />
    </div>
  );
}
