// The subject kits' input fields: a data field (paste, a file, or a table on the open page), column role pickers,
// the long and wide reshape switch, a small matrix grid, a one-value-per-line list, and the seed field. Every field
// has a visible label, says what is wrong in words, and works by keyboard alone; status lines are polite live
// regions, so a screen reader hears what was read.
import { useId, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Button } from '../../../../ui';
import { announce } from '../../../../ui';
import { SUBJECT_TABLES_EVENT } from '../../flags';
import type { DataSet } from '../data/model';
import { MAX_ROWS } from '../data/model';
import type { DecimalChoice } from '../data/parse';
import type { PageBlock, PageTable } from '../data/page';
import { tablesOf } from '../data/page';
import { newSeed, parseSeed } from '../num/rng';
import kitStyles from '../../kits/ui/kit.module.css';
import styles from './subjects.module.css';
import type { DataInput, LongWideValue, MatrixInputValue, RoleSpec, RoleValue } from './input';
import { columnsFor, readList, readMatrix, resizeMatrix, tableText } from './input';
import { sayS } from './words';

/** Asks the open page for its blocks; null when no page answers (none is open, or this window is popped out). */
export function pageBlocks(): PageBlock[] | null {
  const detail: { blocks: PageBlock[] | null } = { blocks: null };
  window.dispatchEvent(new CustomEvent(SUBJECT_TABLES_EVENT, { detail }));
  return detail.blocks;
}

/** One line saying what a data set holds, or why some of it was left out. */
export function DataSummary({ data }: { data: DataSet }) {
  const first = data.problems[0];
  return (
    <div role="status" aria-live="polite">
      <p className={styles.status}>
        {data.columns.length === 0
          ? sayS('data.nothing')
          : data.rows === 1
            ? sayS('data.summaryOne', { columns: data.columns.length })
            : sayS('data.summary', { rows: data.rows, columns: data.columns.length })}
      </p>
      {data.truncated && (
        <p className={styles.warning}>{sayS('data.truncated', { max: MAX_ROWS.toLocaleString('en-US') })}</p>
      )}
      {first && (
        <p className={styles.warning}>
          {sayS('data.problems', {
            count: data.problems.length,
            text: first.text,
            column: first.column,
            row: first.row,
          })}
        </p>
      )}
    </div>
  );
}

const DECIMAL_CHOICES: readonly DecimalChoice[] = ['auto', 'point', 'comma'];

/** The decimal-mark choice, and a line naming the mark a guess used when a column such as 1,234 reads both ways. */
function DecimalPicker({ value, onChange, data }: Omit<DataFieldProps, 'label'>) {
  return (
    <>
      <div className={styles.row}>
        <label className={kitStyles.field}>
          <span>{sayS('data.decimal')}</span>
          <select
            className={kitStyles.input}
            value={value.decimal ?? 'auto'}
            onChange={(event) => onChange({ ...value, decimal: event.target.value as DecimalChoice })}
          >
            {DECIMAL_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {sayS(`data.decimalChoice.${choice}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {data.decimalGuess && (
        <p className={kitStyles.hint} role="status">
          {sayS(data.decimalGuess.decimal === '.' ? 'data.decimalGuessPoint' : 'data.decimalGuessComma', {
            column: data.decimalGuess.column,
          })}
        </p>
      )}
    </>
  );
}

export interface DataFieldProps {
  label: string;
  value: DataInput;
  onChange(next: DataInput): void;
  /** The data set read from `value`, so the field can say what it holds. */
  data: DataSet;
}

export function DataField({ label, value, onChange, data }: DataFieldProps) {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const [tables, setTables] = useState<PageTable[] | null>(null);
  const [chosen, setChosen] = useState(0);
  const [note, setNote] = useState('');

  const findTables = () => {
    const blocks = pageBlocks();
    if (blocks === null) return setNote(sayS('data.noPage'));
    const found = tablesOf(blocks);
    setTables(found);
    setChosen(0);
    setNote(found.length === 0 ? sayS('data.noTables') : '');
  };
  const useTable = () => {
    const table = tables?.[chosen];
    if (!table) return;
    onChange({ ...value, text: tableText(table), table: table.number });
    announce(sayS('data.tableUsed', { number: table.number }));
  };
  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    try {
      onChange({ ...value, text: await picked.text(), table: null });
      announce(sayS('data.fileRead', { name: picked.name }));
    } catch {
      setNote(sayS('data.fileFailed'));
    }
  };

  return (
    <fieldset className={styles.data}>
      <legend className={styles.legend}>{label}</legend>
      <label htmlFor={`${id}-text`} className={kitStyles.hint}>
        {value.table ? `${sayS('data.text')}: ${sayS('data.tableName', { number: value.table })}` : sayS('data.text')}
      </label>
      <textarea
        id={`${id}-text`}
        className={styles.text}
        spellCheck={false}
        autoComplete="off"
        value={value.text}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange({ ...value, text: event.target.value, table: null })}
      />
      <span id={`${id}-hint`} className={kitStyles.hint}>
        {sayS('data.textHint')}
      </span>
      <DecimalPicker value={value} onChange={onChange} data={data} />
      <div className={styles.row}>
        <Button onClick={() => file.current?.click()}>{sayS('data.file')}</Button>
        <input
          ref={file}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          className={styles.hiddenFile}
          tabIndex={-1}
          aria-label={sayS('data.fileLabel')}
          onChange={(event) => void readFile(event)}
        />
        <Button onClick={findTables}>{sayS('data.findTables')}</Button>
        {tables && tables.length > 0 && (
          <>
            <label className={kitStyles.field}>
              <span>{sayS('data.table')}</span>
              <select
                className={kitStyles.input}
                value={chosen}
                onChange={(event) => setChosen(Number(event.target.value))}
              >
                {tables.map((table, i) => (
                  <option key={table.id} value={i}>
                    {sayS('data.tableName', { number: table.number })}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={useTable}>{sayS('data.useTable')}</Button>
          </>
        )}
      </div>
      {note && (
        <p className={styles.warning} role="status">
          {note}
        </p>
      )}
      <DataSummary data={data} />
    </fieldset>
  );
}

export interface ColumnPickerProps {
  data: DataSet;
  roles: readonly RoleSpec[];
  value: RoleValue;
  onChange(next: RoleValue): void;
}

/** One picker per role: a list for a single column, a group of checkboxes for several. */
export function ColumnPicker({ data, roles, value, onChange }: ColumnPickerProps) {
  const id = useId();
  return (
    <div className={kitStyles.row}>
      {roles.map((spec) => {
        const names = columnsFor(data, spec);
        const label = sayS(`roles.${spec.role}`);
        const chosen = value[spec.role];
        if (spec.multiple) {
          const list = Array.isArray(chosen) ? chosen : chosen ? [chosen] : [];
          return (
            <fieldset key={spec.role} className={styles.group}>
              <legend className={styles.legend}>{label}</legend>
              <div className={styles.choices}>
                {names.map((name) => (
                  <label key={name} className={styles.choice}>
                    <input
                      type="checkbox"
                      checked={list.includes(name)}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          [spec.role]: event.target.checked ? [...list, name] : list.filter((n) => n !== name),
                        })
                      }
                    />
                    <span>{name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        }
        const one = typeof chosen === 'string' ? chosen : '';
        return (
          <div key={spec.role} className={kitStyles.field}>
            <label htmlFor={`${id}-${spec.role}`}>{label}</label>
            <select
              id={`${id}-${spec.role}`}
              className={kitStyles.input}
              value={names.includes(one) ? one : ''}
              onChange={(event) => onChange({ ...value, [spec.role]: event.target.value || undefined })}
            >
              <option value="">{spec.optional ? sayS('roles.none') : sayS('roles.choose')}</option>
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

export interface LongWideFieldProps {
  data: DataSet;
  value: LongWideValue;
  onChange(next: LongWideValue): void;
}

/** The reshape switch: leave the data as it is, stack columns into rows, or spread rows into columns. */
export function LongWideField({ data, value, onChange }: LongWideFieldProps) {
  const name = useId();
  const names = data.columns.map((c) => c.name);
  const numbers = data.columns.filter((c) => c.kind === 'number').map((c) => c.name);
  const pick = (mode: LongWideValue['mode']) => {
    if (mode === 'asIs') onChange({ mode });
    else if (mode === 'stack') onChange({ mode, ids: [], measures: [], keyName: 'measure', valueName: 'value' });
    else onChange({ mode, ids: [], key: names[0] ?? '', value: numbers[0] ?? '' });
  };
  const checks = (
    label: string,
    options: readonly string[],
    list: readonly string[],
    set: (next: string[]) => void,
  ) => (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{label}</legend>
      <div className={styles.choices}>
        {options.map((option) => (
          <label key={option} className={styles.choice}>
            <input
              type="checkbox"
              checked={list.includes(option)}
              onChange={(event) => set(event.target.checked ? [...list, option] : list.filter((n) => n !== option))}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
  const select = (label: string, options: readonly string[], current: string, set: (next: string) => void) => (
    <label className={kitStyles.field}>
      <span>{label}</span>
      <select className={kitStyles.input} value={current} onChange={(event) => set(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
  const text = (label: string, current: string, set: (next: string) => void) => (
    <label className={kitStyles.field}>
      <span>{label}</span>
      <input className={kitStyles.input} value={current} onChange={(event) => set(event.target.value)} />
    </label>
  );
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{sayS('longWide.label')}</legend>
      <div className={styles.choices}>
        {(['asIs', 'stack', 'unstack'] as const).map((mode) => (
          <label key={mode} className={styles.choice}>
            <input type="radio" name={name} checked={value.mode === mode} onChange={() => pick(mode)} />
            <span>{sayS(`longWide.${mode}`)}</span>
          </label>
        ))}
      </div>
      {value.mode === 'stack' && (
        <>
          {checks(sayS('longWide.ids'), names, value.ids, (ids) => onChange({ ...value, ids }))}
          {checks(sayS('longWide.measures'), numbers, value.measures, (measures) => onChange({ ...value, measures }))}
          <div className={kitStyles.row}>
            {text(sayS('longWide.keyName'), value.keyName, (keyName) => onChange({ ...value, keyName }))}
            {text(sayS('longWide.valueName'), value.valueName, (valueName) => onChange({ ...value, valueName }))}
          </div>
        </>
      )}
      {value.mode === 'unstack' && (
        <>
          {checks(sayS('longWide.ids'), names, value.ids, (ids) => onChange({ ...value, ids }))}
          <div className={kitStyles.row}>
            {select(sayS('longWide.key'), names, value.key, (key) => onChange({ ...value, key }))}
            {select(sayS('longWide.value'), numbers, value.value, (next) => onChange({ ...value, value: next }))}
          </div>
        </>
      )}
    </fieldset>
  );
}

export interface MatrixFieldProps {
  label: string;
  value: MatrixInputValue;
  onChange(next: MatrixInputValue): void;
  /** Whether the student may rename rows and columns (a contingency table's levels, a game's strategies). */
  editableLabels?: boolean;
  minSize?: number;
  maxSize?: number;
}

/** A small grid of numbers with row and column labels, and buttons to add and remove rows and columns. */
export function MatrixField({
  label,
  value,
  onChange,
  editableLabels = true,
  minSize = 1,
  maxSize = 12,
}: MatrixFieldProps) {
  const id = useId();
  const rows = value.cells.length;
  const cols = value.cells[0]?.length ?? 0;
  const read = readMatrix(value);
  const setCell = (i: number, j: number, text: string) =>
    onChange({
      ...value,
      cells: value.cells.map((row, r) => (r === i ? row.map((c, k) => (k === j ? text : c)) : row)),
    });
  const setLabel = (which: 'rowLabels' | 'colLabels', i: number, text: string) =>
    onChange({ ...value, [which]: value[which].map((l, k) => (k === i ? text : l)) });
  const labelCell = (which: 'rowLabels' | 'colLabels', i: number) =>
    editableLabels ? (
      <input
        className={`${styles.cell} ${styles.labelCell}`}
        aria-label={sayS(
          which === 'rowLabels' ? 'matrix.rowLabel' : 'matrix.columnLabel',
          which === 'rowLabels' ? { row: i + 1 } : { column: i + 1 },
        )}
        value={value[which][i]}
        onChange={(event) => setLabel(which, i, event.target.value)}
      />
    ) : (
      value[which][i]
    );
  return (
    <fieldset className={styles.group} aria-describedby={read.ok ? undefined : `${id}-problem`}>
      <legend className={styles.legend}>{label}</legend>
      <div className={styles.gridScroll}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <td />
              {value.colLabels.map((_, j) => (
                <th key={j} scope="col">
                  {labelCell('colLabels', j)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.cells.map((row, i) => (
              <tr key={i}>
                <th scope="row">{labelCell('rowLabels', i)}</th>
                {row.map((cell, j) => (
                  <td key={j}>
                    <input
                      className={styles.cell}
                      inputMode="decimal"
                      spellCheck={false}
                      autoComplete="off"
                      aria-label={sayS('matrix.cell', {
                        row: value.rowLabels[i] || i + 1,
                        column: value.colLabels[j] || j + 1,
                      })}
                      aria-invalid={!read.ok && read.row === i + 1 && read.column === j + 1 ? true : undefined}
                      value={cell}
                      onChange={(event) => setCell(i, j, event.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.row}>
        <Button disabled={rows >= maxSize} onClick={() => onChange(resizeMatrix(value, rows + 1, cols))}>
          {sayS('matrix.addRow')}
        </Button>
        <Button disabled={rows <= minSize} onClick={() => onChange(resizeMatrix(value, rows - 1, cols))}>
          {sayS('matrix.removeRow')}
        </Button>
        <Button disabled={cols >= maxSize} onClick={() => onChange(resizeMatrix(value, rows, cols + 1))}>
          {sayS('matrix.addColumn')}
        </Button>
        <Button disabled={cols <= minSize} onClick={() => onChange(resizeMatrix(value, rows, cols - 1))}>
          {sayS('matrix.removeColumn')}
        </Button>
      </div>
      {!read.ok && (
        <p id={`${id}-problem`} className={kitStyles.fieldProblem}>
          {sayS('matrix.notNumber', { row: read.row, column: read.column })}
        </p>
      )}
    </fieldset>
  );
}

export interface ListFieldProps {
  label: string;
  value: string;
  onChange(next: string): void;
}

/** One value per line, with a count and the first line that is not a number. */
export function ListField({ label, value, onChange }: ListFieldProps) {
  const id = useId();
  const read = readList(value);
  const first = read.problems[0];
  return (
    <div className={kitStyles.field}>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className={styles.text}
        spellCheck={false}
        value={value}
        aria-invalid={first ? true : undefined}
        aria-describedby={`${id}-status`}
        onChange={(event) => onChange(event.target.value)}
      />
      <span id={`${id}-status`} className={first ? kitStyles.fieldProblem : kitStyles.hint} role="status">
        {first
          ? sayS('list.notNumber', { line: first.line, text: first.text })
          : `${sayS('list.hint')} ${sayS('list.count', { count: read.values.length })}`}
      </span>
    </div>
  );
}

export interface SeedFieldProps {
  value: string;
  onChange(next: string): void;
}

/** The seed of a simulation: shown, typed, or replaced with a new one. */
export function SeedField({ value, onChange }: SeedFieldProps) {
  const id = useId();
  const bad = parseSeed(value) === null;
  const fresh = () => {
    const seed = newSeed().toString();
    onChange(seed);
    announce(sayS('seed.changed', { seed }));
  };
  return (
    <div className={kitStyles.field}>
      <label htmlFor={id}>{sayS('seed.label')}</label>
      <div className={styles.row}>
        <input
          id={id}
          className={`${kitStyles.input} ${kitStyles.number}`}
          inputMode="numeric"
          spellCheck={false}
          autoComplete="off"
          value={value}
          aria-invalid={bad ? true : undefined}
          aria-describedby={`${id}-hint`}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button onClick={fresh}>{sayS('seed.new')}</Button>
      </div>
      <span id={`${id}-hint`} className={bad ? kitStyles.fieldProblem : kitStyles.hint}>
        {bad ? sayS('seed.invalid') : sayS('seed.hint')}
      </span>
    </div>
  );
}
