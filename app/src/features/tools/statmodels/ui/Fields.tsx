// The fields a statistics tool is made of: a table of data (pasted, or opened from a CSV or TSV file on this
// device), columns picked from it by name, numbers, choices, and free text such as a model formula. Each field is
// labeled, says what it takes, and marks a problem in words beside it.
import { useId, useRef } from 'react';
import { Button, announce } from '../../../../ui';
import { columnNames, parseTable } from '../kit/data';
import { COLUMN_SEPARATOR, columnList, type Field } from '../kit/spec';
import type { StatError } from '../kit/types';
import type { Say } from './insert';
import styles from './statmodels.module.css';

export interface FieldProps {
  readonly tool: string;
  readonly field: Field;
  readonly text: string;
  /** The texts of the tool's fields, for the column pickers. */
  readonly texts: Readonly<Record<string, string>>;
  readonly problem: StatError | undefined;
  readonly say: Say;
  readonly errorText: (error: StatError) => string;
  readonly onChange: (text: string) => void;
}

const MAX_FILE = 5_000_000;

function Problem({ id, problem, errorText }: { id: string; problem: StatError; errorText: FieldProps['errorText'] }) {
  return (
    <p id={id} className={styles.problem}>
      {errorText(problem)}
    </p>
  );
}

function dataSummary(text: string, say: Say): string {
  try {
    const table = parseTable(text);
    return say('kitStatModels.ui.dataSummary', { rows: table.cells.length, columns: table.names.join(', ') });
  } catch {
    return say('kitStatModels.ui.dataHint');
  }
}

function DataInput(props: FieldProps) {
  const { field, text, say, problem } = props;
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const open = async (chosen: File | undefined) => {
    if (!chosen) return;
    if (chosen.size > MAX_FILE) announce(say('kitStatModels.ui.fileTooLarge'));
    else props.onChange(await chosen.text());
  };
  return (
    <div className={`${styles.field} ${styles.wide}`}>
      <label htmlFor={id}>{say(`kitStatModels.${props.tool}.field.${field.id}`)}</label>
      <textarea
        id={id}
        className={`${styles.input} ${styles.textarea}`}
        rows={field.type === 'data' ? field.rows : 6}
        value={text}
        spellCheck={false}
        aria-invalid={problem ? true : undefined}
        aria-describedby={`${id}-hint`}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <div className={styles.buttons}>
        <Button onClick={() => file.current?.click()}>{say('kitStatModels.ui.openFile')}</Button>
        <input
          ref={file}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          hidden
          onChange={(event) => void open(event.target.files?.[0])}
        />
      </div>
      {problem ? (
        <Problem id={`${id}-hint`} problem={problem} errorText={props.errorText} />
      ) : (
        <span id={`${id}-hint`} className={styles.hint}>
          {dataSummary(text, say)}
        </span>
      )}
    </div>
  );
}

function ColumnInput(props: FieldProps & { field: Field & { type: 'column' } }) {
  const { field, text, say, problem } = props;
  const id = useId();
  const names = columnNames(props.texts[field.data] ?? '');
  const label = say(`kitStatModels.${props.tool}.field.${field.id}`);
  const picked = columnList(text);
  if (field.multi) {
    const toggle = (name: string, on: boolean) =>
      props.onChange(names.filter((n) => (n === name ? on : picked.includes(n))).join(COLUMN_SEPARATOR));
    return (
      <fieldset
        className={`${styles.field} ${styles.wide} ${styles.group}`}
        aria-describedby={problem ? `${id}-p` : undefined}
      >
        <legend>{label}</legend>
        <div className={styles.checks}>
          {names.map((name) => (
            <label key={name} className={styles.check}>
              <input type="checkbox" checked={picked.includes(name)} onChange={(e) => toggle(name, e.target.checked)} />
              <span>{name}</span>
            </label>
          ))}
        </div>
        {problem && <Problem id={`${id}-p`} problem={problem} errorText={props.errorText} />}
      </fieldset>
    );
  }
  const value = names.includes(picked[0] ?? '') ? picked[0] : '';
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className={styles.input}
        value={value}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-p` : undefined}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {(field.optional || value === '') && (
          <option value="">{say(field.optional ? 'kitStatModels.ui.none' : 'kitStatModels.ui.pickColumn')}</option>
        )}
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {problem && <Problem id={`${id}-p`} problem={problem} errorText={props.errorText} />}
    </div>
  );
}

export function FieldInput(props: FieldProps) {
  const { tool, field, text, say, problem } = props;
  const id = useId();
  if (field.type === 'data') return <DataInput {...props} />;
  if (field.type === 'column') return <ColumnInput {...props} field={field} />;
  const label = say(`kitStatModels.${tool}.field.${field.id}`);
  if (field.type === 'choice') {
    return (
      <div className={styles.field}>
        <label htmlFor={id}>{label}</label>
        <select id={id} className={styles.input} value={text} onChange={(event) => props.onChange(event.target.value)}>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {say(`kitStatModels.${tool}.option.${option}`)}
            </option>
          ))}
        </select>
      </div>
    );
  }
  const wide = field.type === 'text';
  const hintId = `${id}-hint`;
  return (
    <div className={wide ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{label}</label>
      {wide ? (
        <textarea
          id={id}
          className={`${styles.input} ${styles.textarea}`}
          rows={field.rows}
          value={text}
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby={hintId}
          onChange={(event) => props.onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          type="text"
          inputMode="decimal"
          className={styles.input}
          value={text}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem || wide ? hintId : undefined}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
      {problem ? (
        <Problem id={hintId} problem={problem} errorText={props.errorText} />
      ) : (
        wide && (
          <span id={hintId} className={styles.hint}>
            {say(`kitStatModels.${tool}.hint.${field.id}`)}
          </span>
        )
      )}
    </div>
  );
}
