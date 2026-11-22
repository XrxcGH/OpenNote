// The controls the tabs of the Format Cells dialog share: a labeled field, a select, a number box, and a color
// button that opens the shared palette inside the dialog.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../../../../strings/t';
import { ColorPalette } from '../../../../ui/color';
import type { ColorPick } from '../../../../ui/color';
import type { Scheme } from '../../../../ui/color/parse';
import type { CellStyle } from '../../sheet/model';
import { snapNumber } from './draft';
import styles from './formatCells.module.css';

/** What every tab gets: the working style, a way to change it, and the color context. */
export interface TabProps {
  style: CellStyle;
  set(style: CellStyle): void;
  scheme: Scheme;
  notebookId: string;
}

export const num = (text: string, fallback: number | undefined): number | undefined => {
  if (text.trim() === '') return fallback;
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
};

export interface FieldProps {
  label: string;
  children: (id: string) => ReactNode;
}

/** A label above a control, tied to it. */
export function Field({ label, children }: FieldProps) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

interface SelectProps<V extends string> {
  label: string;
  value: V;
  values: readonly V[];
  name(value: V): string;
  onChange(value: V): void;
}

export function Select<V extends string>({ label, value, values, name, onChange }: SelectProps<V>) {
  return (
    <Field label={label}>
      {(id) => (
        <select id={id} className={styles.input} value={value} onChange={(e) => onChange(e.target.value as V)}>
          {values.map((v) => (
            <option key={v} value={v}>
              {name(v)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

interface NumberInputProps {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  onChange(value: number | undefined): void;
}

export function NumberInput({ label, value, min, max, step = 1, onChange }: NumberInputProps) {
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          className={styles.input}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value ?? ''}
          onChange={(e) => {
            const n = num(e.target.value, undefined);
            onChange(n === undefined ? undefined : snapNumber(n, min, max, step));
          }}
        />
      )}
    </Field>
  );
}

interface ColorFieldProps {
  label: string;
  value: string | undefined;
  /** A fill has No color and no Automatic; a text color has Automatic. */
  fill?: boolean;
  scheme: Scheme;
  notebookId: string;
  onPick(value: string | undefined): void;
}

/** A button that shows the color; pressing it opens the shared palette inside the dialog. */
export function ColorField({ label, value, fill, scheme, notebookId, onPick }: ColorFieldProps) {
  const [open, setOpen] = useState(false);
  const shown = value ?? t(fill ? 'sheetFormat.color.none' : 'sheetFormat.color.automatic');
  const choose = (pick: ColorPick) => {
    onPick(pick.kind === 'color' ? pick.value : undefined);
    setOpen(false);
  };
  return (
    <div className={styles.field}>
      <span>{label}</span>
      <button
        type="button"
        className={styles.colorButton}
        aria-expanded={open}
        aria-label={t('sheetFormat.color.choose', { label, value: shown })}
        onClick={() => setOpen(!open)}
      >
        <span className={styles.swatch} style={value ? { background: value } : undefined} aria-hidden="true" />
        {shown}
      </button>
      {open ? (
        <div className={styles.palette}>
          <ColorPalette
            scheme={scheme}
            notebookId={notebookId}
            automatic={!fill}
            noColor={fill}
            current={value}
            onPick={choose}
          />
        </div>
      ) : null}
    </div>
  );
}
