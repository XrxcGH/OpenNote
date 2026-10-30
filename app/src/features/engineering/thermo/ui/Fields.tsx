// The inputs of a kit tool: a number with a unit picker limited to its kind of quantity, a choice, or a list of
// numbers. Every field has a visible label, and a field whose text is not a number says so in words.
import { t } from '../../../../strings/t';
import type { FieldSpec } from '../common/spec';
import { unitsFor, type System } from '../common/units';
import { say } from './say';
import styles from './thermo.module.css';

export interface FieldProps {
  field: FieldSpec;
  idPrefix: string;
  text: string;
  unit: string;
  system: System;
  invalid: boolean;
  onText(next: string): void;
  onUnit(next: string): void;
}

export function Field({ field, idPrefix, text, unit, system, invalid, onText, onUnit }: FieldProps) {
  const id = `${idPrefix}-${field.id}`;
  const label = say(`kitThermo.field.${field.label}`);
  if (field.kind === 'choice') {
    return (
      <label className={styles.field}>
        <span>{label}</span>
        <select className={styles.input} value={text} onChange={(event) => onText(event.target.value)}>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {say(`kitThermo.choice.${option.label}`)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const units = field.kind === 'list' ? [] : unitsFor(field.qty ?? 'none', system).filter((one) => one.id !== '');
  return (
    <div className={field.kind === 'list' ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={units.length ? styles.withUnit : undefined}>
        <input
          id={id}
          type="text"
          inputMode={field.kind === 'list' ? 'text' : 'decimal'}
          className={styles.input}
          value={text}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? `${id}-problem` : undefined}
          onChange={(event) => onText(event.target.value)}
        />
        {units.length > 1 ? (
          <select
            className={styles.input}
            aria-label={t('kitThermo.ui.unitFor', { name: label })}
            value={unit}
            onChange={(event) => onUnit(event.target.value)}
          >
            {units.map((one) => (
              <option key={one.id} value={one.id}>
                {one.id}
              </option>
            ))}
          </select>
        ) : units.length === 1 ? (
          <span className={styles.note}>{units[0].id}</span>
        ) : null}
      </div>
      {invalid ? (
        <p id={`${id}-problem`} className={styles.problem}>
          {t('kitThermo.ui.notNumber')}
        </p>
      ) : null}
    </div>
  );
}
