// Picking columns of a data set for the statistics kit: a list for one numeric column, checkboxes for several, and
// the reading of chosen columns row by row (rows with a missing value in any chosen column are left out).
import { useId } from 'react';
import { columnNamed, completeRows, type DataSet } from '../../subjects/data/model';
import { check } from '../report';
import styles from './kit.module.css';
import { say } from './parts';

const numberColumns = (data: DataSet): string[] => data.columns.filter((c) => c.kind === 'number').map((c) => c.name);

export function ColumnSelect(props: { data: DataSet; label: string; value: string; onChange: (name: string) => void }) {
  const id = useId();
  const names = numberColumns(props.data);
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        className={styles.input}
        value={names.includes(props.value) ? props.value : ''}
        onChange={(event) => props.onChange(event.target.value)}
      >
        <option value="">{say('kitStatInfer.ui.chooseColumn')}</option>
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ColumnChecks(props: {
  data: DataSet;
  label: string;
  value: readonly string[];
  onChange: (names: string[]) => void;
}) {
  const names = numberColumns(props.data);
  return (
    <fieldset className={styles.group}>
      <legend>{props.label}</legend>
      <div className={styles.row}>
        {names.map((name) => (
          <label key={name} className={styles.check}>
            <input
              type="checkbox"
              checked={props.value.includes(name)}
              onChange={(event) =>
                props.onChange(event.target.checked ? [...props.value, name] : props.value.filter((n) => n !== name))
              }
            />
            <span>{name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The first numeric columns of a data set, used until the student picks others. */
export const firstNumbers = (data: DataSet, count: number): string[] => numberColumns(data).slice(0, count);

/** The chosen numeric columns over the rows complete in all of them. */
export function readColumns(data: DataSet, names: readonly string[]): { name: string; values: number[] }[] {
  check(data.columns.length > 0, 'empty');
  for (const name of names) {
    const column = columnNamed(data, name);
    check(column !== null && column.kind === 'number', 'chooseColumns');
  }
  const { rows } = completeRows(data, names);
  return names.map((name) => {
    const column = columnNamed(data, name);
    const values = column && column.kind === 'number' ? column.values : [];
    return { name, values: rows.map((r) => values[r] as number) };
  });
}
