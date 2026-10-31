// The controls of a life-systems form: a number with its unit, a choice, free text, and a data box that takes a
// pasted table or a CSV, TSV or text file opened from this device (read here; nothing is uploaded).
import { useRef } from 'react';
import { Button, announce } from '../../../../ui';
import type { FieldSpec } from '../types';
import { UNIT_GROUPS } from '../units';
import styles from './lifesys.module.css';
import { parseNumber } from './text';
import { word } from './words';

export interface Values {
  text: Record<string, string>;
  unit: Record<string, string>;
}

interface FieldProps {
  field: FieldSpec;
  idBase: string;
  values: Values;
  setText(id: string, value: string): void;
  setUnit(id: string, value: string): void;
}

function DataBox({ field, idBase, values, setText }: FieldProps) {
  const id = `${idBase}-${field.id}`;
  const file = useRef<HTMLInputElement>(null);
  const open = async (chosen: File | undefined) => {
    if (!chosen) return;
    setText(field.id, await chosen.text());
    announce(word('ui.fileRead', { name: chosen.name }));
  };
  return (
    <div className={`${styles.field} ${styles.wide}`}>
      <label htmlFor={id}>{word(field.label)}</label>
      <textarea
        id={id}
        className={styles.input}
        value={values.text[field.id] ?? ''}
        spellCheck={false}
        aria-describedby={field.help ? `${id}-help` : undefined}
        onChange={(e) => setText(field.id, e.target.value)}
      />
      {field.help ? (
        <p id={`${id}-help`} className={styles.note}>
          {word(field.help)}
        </p>
      ) : null}
      <input
        ref={file}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => void open(e.target.files?.[0])}
      />
      <Button variant="quiet" className={styles.fileButton} onClick={() => file.current?.click()}>
        {word('ui.openFile')}
      </Button>
    </div>
  );
}

export function Field(props: FieldProps) {
  const { field, idBase, values, setText, setUnit } = props;
  if (field.kind === 'data') return <DataBox {...props} />;
  const id = `${idBase}-${field.id}`;
  const value = values.text[field.id] ?? '';
  const invalid = (field.kind ?? 'number') === 'number' && value.trim() !== '' && Number.isNaN(parseNumber(value));
  const control =
    field.kind === 'select' ? (
      <select id={id} className={styles.input} value={value} onChange={(e) => setText(field.id, e.target.value)}>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {word(o.label)}
          </option>
        ))}
      </select>
    ) : (
      <input
        id={id}
        type="text"
        inputMode={field.kind === 'text' ? 'text' : 'decimal'}
        className={styles.input}
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid ? true : undefined}
        aria-describedby={field.help ? `${id}-help` : undefined}
        onChange={(e) => setText(field.id, e.target.value)}
      />
    );
  const units = field.unit ? UNIT_GROUPS[field.unit] : null;
  return (
    <div className={field.kind === 'text' ? styles.wide : undefined}>
      <div className={units ? styles.withUnit : undefined}>
        <div className={styles.field}>
          <label htmlFor={id}>{word(field.label)}</label>
          {control}
        </div>
        {units ? (
          <select
            className={styles.input}
            aria-label={word('ui.unitFor', { name: word(field.label) })}
            value={values.unit[field.id] ?? field.unitInitial ?? units[0].id}
            onChange={(e) => setUnit(field.id, e.target.value)}
          >
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.id}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {field.help ? (
        <p id={`${id}-help`} className={styles.note}>
          {word(field.help)}
        </p>
      ) : null}
    </div>
  );
}
