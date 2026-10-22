// A field for a value with an SI prefix, such as 4.7 kΩ or 2 mA. It shows the value with its prefix, reads what the
// person types on Enter or when focus leaves, and says so when the text is not a value.
import { useId, useState } from 'react';
import styles from '../canvas/canvas.module.css';

interface Props {
  label: string;
  help: string;
  unit: string;
  value: number;
  parse(text: string, unit: string): number | null;
  show(value: number, unit: string): string;
  onChange(value: number): void;
}

export function QuantityField({ label, help, unit, value, parse, show, onChange }: Props) {
  const shown = show(value, unit);
  const [edit, setEdit] = useState({ text: shown, base: value, bad: false });
  const current = edit.base === value ? edit : { text: shown, base: value, bad: false };
  const id = useId();
  const helpId = `${id}-help`;
  const save = () => {
    const next = parse(current.text, unit);
    if (next === null) return setEdit({ ...current, bad: true });
    setEdit({ text: show(next, unit), base: next, bad: false });
    if (next !== value) onChange(next);
  };
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={current.text}
        aria-invalid={current.bad || undefined}
        aria-describedby={helpId}
        onChange={(event) => setEdit({ text: event.target.value, base: value, bad: false })}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save();
        }}
      />
      <span id={helpId} className={current.bad ? styles.problem : styles.hint}>
        {help}
      </span>
    </div>
  );
}
