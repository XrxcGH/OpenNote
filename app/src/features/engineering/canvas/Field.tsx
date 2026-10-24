// A labeled field for a part's number or name. It keeps the typed text while the person edits and saves on Enter or
// when focus leaves, so a half-typed "-" or "1." is never turned into a number too early.
import { useState } from 'react';
import { readNumber } from './shared';
import styles from './canvas.module.css';

interface NumberProps {
  label: string;
  value: number;
  readOnly?: boolean;
  min?: number;
  onChange(value: number): void;
}

export function NumberField({ label, value, readOnly, min, onChange }: NumberProps) {
  const [edit, setEdit] = useState({ text: String(value), base: value });
  // A new value from outside (a drag, undo) replaces what was being typed.
  const text = edit.base === value ? edit.text : String(value);
  const setText = (next: string) => setEdit({ text: next, base: value });
  const save = () => {
    let next = readNumber(text, value);
    if (min !== undefined) next = Math.max(min, next);
    setText(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <label className={styles.field}>
      {label}
      <input
        inputMode="decimal"
        value={text}
        readOnly={readOnly}
        onChange={(event) => setText(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save();
        }}
      />
    </label>
  );
}

interface TextProps {
  label: string;
  value: string;
  readOnly?: boolean;
  onChange(value: string): void;
}

export function TextInput({ label, value, readOnly, onChange }: TextProps) {
  const [edit, setEdit] = useState({ text: value, base: value });
  const text = edit.base === value ? edit.text : value;
  const setText = (next: string) => setEdit({ text: next, base: value });
  const save = () => {
    const next = text.trim().slice(0, 40);
    if (next !== value) onChange(next);
  };
  return (
    <label className={styles.field}>
      {label}
      <input
        value={text}
        readOnly={readOnly}
        onChange={(event) => setText(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save();
        }}
      />
    </label>
  );
}

interface SelectProps<V extends string> {
  label: string;
  value: V;
  options: readonly { value: V; label: string }[];
  disabled?: boolean;
  onChange(value: V): void;
}

export function SelectField<V extends string>({ label, value, options, disabled, onChange }: SelectProps<V>) {
  return (
    <label className={styles.field}>
      {label}
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as V)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
