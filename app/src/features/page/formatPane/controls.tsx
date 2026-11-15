// The small controls of the Format pane: a text or number box that commits on Enter or blur, a choice, and a check.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../../../strings/t';
import { optionLabel } from './labels';
import styles from './FormatPane.module.css';

export interface BoxProps {
  label: string;
  value: string;
  /** 'pt' or '%' beside the box. */
  unit?: string;
  placeholder?: string;
  error?: string;
  /** A number box: Up and Down step it, and it is a spin button. */
  step?: number;
  disabled?: boolean;
  onCommit(text: string): void;
}

/** A labeled box. What is typed commits on Enter or when focus leaves; Escape puts the old value back. */
export function Box({ label, value, unit, placeholder, error, step, disabled, onCommit }: BoxProps) {
  const id = useId();
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const finish = (text: string) => {
    setDraft(null);
    if (text !== value) onCommit(text);
  };
  const number = Number(shown.replace(',', '.'));
  const spin = step !== undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.row}>
        <input
          id={id}
          className={styles.input}
          value={shown}
          disabled={disabled}
          placeholder={placeholder}
          role={spin ? 'spinbutton' : undefined}
          aria-valuenow={spin && Number.isFinite(number) && shown !== '' ? number : undefined}
          aria-valuetext={spin && shown !== '' ? `${shown}${unit ? ` ${unit}` : ''}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => draft !== null && finish(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              finish(shown);
            } else if (event.key === 'Escape' && draft !== null) {
              event.stopPropagation();
              setDraft(null);
            } else if (spin && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && Number.isFinite(number)) {
              event.preventDefault();
              const by = (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1);
              finish(String(Math.round((number + by) * 100) / 100));
            }
          }}
        />
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" className={styles.warning}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface ChoiceProps {
  label: string;
  field: string;
  options: readonly string[];
  value: string;
  disabled?: boolean;
  onCommit(value: string): void;
}

/** A labeled list of choices. A selection that mixes values shows "Mixed" until one is chosen. */
export function Choice({ label, field, options, value, disabled, onCommit }: ChoiceProps) {
  const id = useId();
  const mixed = value === 'mixed';
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <select
        id={id}
        className={styles.select}
        value={mixed ? '' : value}
        disabled={disabled}
        onChange={(event) => onCommit(event.target.value)}
      >
        {mixed ? (
          <option value="" disabled>
            {t('textPane.mixed')}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabel(field, option)}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface CheckProps {
  label: string;
  value: boolean | 'mixed';
  disabled?: boolean;
  onCommit(on: boolean): void;
}

export function Check({ label, value, disabled, onCommit }: CheckProps) {
  const id = useId();
  return (
    <div className={styles.check}>
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        disabled={disabled}
        ref={(node) => {
          if (node) node.indeterminate = value === 'mixed';
        }}
        onChange={(event) => onCommit(event.target.checked)}
      />
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
    </div>
  );
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{title}</legend>
      {children}
    </fieldset>
  );
}
