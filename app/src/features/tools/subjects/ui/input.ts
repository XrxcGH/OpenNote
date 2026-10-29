// The pure side of the subject input fields: what a data field, a list, a matrix, and the column roles save, and how
// each is read. A field saves plain text, so a live block or a figure keeps its data with it and reopens the same
// numbers even when the page table it came from has changed or gone.
import { readNumber, parseDataText } from '../data/parse';
import { stack, unstack } from '../data/longWide';
import type { ColumnKind, DataSet } from '../data/model';
import { columnNamed, emptyDataSet } from '../data/model';
import { SubjectError } from '../errors';
import type { PageTable } from '../data/page';
import { gridOf } from '../data/page';

/** What a data field saves: the text, and which page table it came from (a label only; the text is the data). */
export interface DataInput {
  text: string;
  /** The page table's number when the text came from one, so the field can say so. */
  table?: number | null;
}

export const emptyDataInput = (): DataInput => ({ text: '', table: null });

/** Reads a data field. Blank text is an empty data set. */
export const readDataInput = (input: DataInput): DataSet =>
  input.text.trim() === '' ? emptyDataSet() : parseDataText(input.text);

/** A page table as tab-separated text, the way a data field keeps it. Tabs and line breaks in cells become spaces. */
export function tableText(table: PageTable): string {
  return gridOf(table)
    .map((row) => row.map((cell) => cell.replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n');
}

export type Convention = { decimal: '.'; group: ',' } | { decimal: ','; group: '.' };
const DOT: Convention = { decimal: '.', group: ',' };
const COMMA: Convention = { decimal: ',', group: '.' };

/** A decimal comma when some line looks like "3,25" and none like "3.25" or "1,234.5". */
function guessConvention(lines: readonly string[]): Convention {
  const comma = lines.some((l) => /^[-+−]?\d*,\d+$/.test(l) && !/^\d{1,3},\d{3}$/.test(l));
  const dot = lines.some((l) => /\d\.\d/.test(l));
  return comma && !dot ? COMMA : DOT;
}

export interface ListProblem {
  line: number;
  text: string;
}

export interface ListRead {
  values: number[];
  /** Lines that are not numbers. Blank lines and missing markers are skipped, not problems. */
  problems: ListProblem[];
}

/** Reads one value per line. */
export function readList(text: string): ListRead {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const convention = guessConvention(lines);
  const values: number[] = [];
  const problems: ListProblem[] = [];
  lines.forEach((line, i) => {
    if (line === '' || /^(na|n\/a|\.|nan)$/i.test(line)) return;
    const read = readNumber(line, convention);
    if (read && Number.isFinite(read.value)) values.push(read.value);
    else problems.push({ line: i + 1, text: line });
  });
  return { values, problems };
}

/** What a matrix field saves: cell text by row, and the row and column labels. */
export interface MatrixInputValue {
  cells: string[][];
  rowLabels: string[];
  colLabels: string[];
}

export function emptyMatrix(rows: number, cols: number): MatrixInputValue {
  return {
    cells: Array.from({ length: rows }, () => new Array<string>(cols).fill('')),
    rowLabels: Array.from({ length: rows }, (_, i) => `R${i + 1}`),
    colLabels: Array.from({ length: cols }, (_, j) => `C${j + 1}`),
  };
}

/** Grows or shrinks a matrix to `rows` by `cols`, keeping what fits and labeling new rows and columns. */
export function resizeMatrix(m: MatrixInputValue, rows: number, cols: number): MatrixInputValue {
  const fresh = emptyMatrix(rows, cols);
  return {
    cells: fresh.cells.map((row, i) => row.map((_, j) => m.cells[i]?.[j] ?? '')),
    rowLabels: fresh.rowLabels.map((l, i) => m.rowLabels[i] ?? l),
    colLabels: fresh.colLabels.map((l, j) => m.colLabels[j] ?? l),
  };
}

export type MatrixRead = { ok: true; values: number[][] } | { ok: false; row: number; column: number };

/** Reads every cell as a number; the first cell that is not one is reported by its 1-based row and column. */
export function readMatrix(m: MatrixInputValue): MatrixRead {
  const convention = guessConvention(m.cells.flat().map((c) => c.trim()));
  const values: number[][] = [];
  for (let i = 0; i < m.cells.length; i += 1) {
    const row: number[] = [];
    for (let j = 0; j < m.cells[i].length; j += 1) {
      const read = readNumber(m.cells[i][j], convention);
      if (!read || !Number.isFinite(read.value)) return { ok: false, row: i + 1, column: j + 1 };
      row.push(read.value);
    }
    values.push(row);
  }
  return { ok: true, values };
}

export type Role = 'response' | 'predictors' | 'group' | 'subject' | 'weight' | 'time' | 'event';

export interface RoleSpec {
  role: Role;
  /** The column kinds the role accepts; any kind when left out. */
  kinds?: readonly ColumnKind[];
  multiple?: boolean;
  optional?: boolean;
}

export type RoleValue = Partial<Record<Role, string | string[]>>;

/** The columns a role may take. */
export const columnsFor = (data: DataSet, spec: RoleSpec): string[] =>
  data.columns.filter((c) => !spec.kinds || spec.kinds.includes(c.kind)).map((c) => c.name);

/** The roles that still need a column: required, and empty or naming a column the data no longer has. */
export function missingRoles(data: DataSet, specs: readonly RoleSpec[], value: RoleValue): Role[] {
  return specs
    .filter((spec) => {
      if (spec.optional) return false;
      const chosen = value[spec.role];
      const names = Array.isArray(chosen) ? chosen : chosen ? [chosen] : [];
      const allowed = columnsFor(data, spec);
      return names.length === 0 || names.some((n) => !allowed.includes(n));
    })
    .map((spec) => spec.role);
}

/** What the reshape switch saves. */
export type LongWideValue =
  | { mode: 'asIs' }
  | { mode: 'stack'; ids: string[]; measures: string[]; keyName: string; valueName: string }
  | { mode: 'unstack'; ids: string[]; key: string; value: string };

/** Applies the reshape switch. A column it names that the data lacks is reported as a 'shape' error. */
export function applyLongWide(data: DataSet, value: LongWideValue): DataSet {
  if (value.mode === 'asIs') return data;
  const named = value.mode === 'stack' ? [...value.ids, ...value.measures] : [...value.ids, value.key, value.value];
  const absent = named.find((n) => !columnNamed(data, n));
  if (absent !== undefined) throw new SubjectError('shape', absent);
  return value.mode === 'stack'
    ? stack(data, value.ids, value.measures, { key: value.keyName, value: value.valueName })
    : unstack(data, value.ids, value.key, value.value);
}
