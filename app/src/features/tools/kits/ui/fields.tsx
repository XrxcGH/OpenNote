// The kits' input fields: a quantity (a number and a unit picker limited to its kind), a choice, and the SI / US
// switch. Each field has a visible label, says what is wrong with its value in words, and works by keyboard alone.
import { useId } from 'react';
import type { QuantityKind, UnitSystem } from '../units';
import { unitChoices } from '../units';
import type { QuantityInput, QuantityRules } from './quantity';
import { readQuantity } from './quantity';
import { say } from './words';
import styles from './kit.module.css';

export interface QuantityFieldProps {
  label: string;
  kind: QuantityKind;
  system: UnitSystem;
  value: QuantityInput;
  onChange(next: QuantityInput): void;
  rules?: QuantityRules;
  /** A short hint under the field, such as the range a correlation covers. */
  hint?: string;
}

/** The units the picker offers: the system's list, plus the field's unit when it is from the other system. */
function unitsFor(kind: QuantityKind, system: UnitSystem, current: string) {
  const list = unitChoices(kind, system);
  if (list.some((unit) => unit.label === current)) return list;
  const other = unitChoices(kind, system === 'SI' ? 'US' : 'SI').filter((unit) => unit.label === current);
  return [...other, ...list];
}

export function QuantityField({ label, kind, system, value, onChange, rules, hint }: QuantityFieldProps) {
  const id = useId();
  const read = readQuantity(value, kind, rules);
  const problem = read.ok ? '' : say(read.key, read.vars);
  const units = unitsFor(kind, system, value.unit);
  const hasUnit = units.some((unit) => unit.label !== '');
  const describedBy = [hint ? `${id}-hint` : '', problem ? `${id}-problem` : ''].filter(Boolean).join(' ');
  return (
    <div className={styles.field}>
      <label htmlFor={`${id}-value`}>{label}</label>
      <div className={styles.quantity}>
        <input
          id={`${id}-value`}
          className={`${styles.input} ${styles.number}`}
          type="text"
          inputMode="decimal"
          spellCheck={false}
          autoComplete="off"
          value={value.text}
          aria-invalid={problem ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(event) => onChange({ ...value, text: event.target.value })}
        />
        {hasUnit && (
          <select
            className={`${styles.input} ${styles.unit}`}
            aria-label={say('kits.field.unit', { label })}
            value={value.unit}
            onChange={(event) => onChange({ ...value, unit: event.target.value })}
          >
            {units.map((unit) => (
              <option key={unit.label} value={unit.label}>
                {unit.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {hint && (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      )}
      {problem && (
        <span id={`${id}-problem`} className={styles.fieldProblem}>
          {problem}
        </span>
      )}
    </div>
  );
}

export interface ChoiceFieldProps<V extends string> {
  label: string;
  value: V;
  options: readonly { value: V; label: string }[];
  onChange(next: V): void;
}

export function ChoiceField<V extends string>({ label, value, options, onChange }: ChoiceFieldProps<V>) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <select id={id} className={styles.input} value={value} onChange={(event) => onChange(event.target.value as V)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The SI / US customary switch: two radio buttons in a group, so arrow keys move between them. */
export function SystemToggle({ system, onChange }: { system: UnitSystem; onChange(next: UnitSystem): void }) {
  const name = useId();
  return (
    <fieldset className={styles.system}>
      <legend className={styles.systemLegend}>{say('kits.system.label')}</legend>
      {(['SI', 'US'] as const).map((one) => (
        <label key={one} className={styles.systemOption}>
          <input type="radio" name={name} value={one} checked={system === one} onChange={() => onChange(one)} />
          <span>{say(one === 'SI' ? 'kits.system.si' : 'kits.system.us')}</span>
        </label>
      ))}
    </fieldset>
  );
}
