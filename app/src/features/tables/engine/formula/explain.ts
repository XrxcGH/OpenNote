// Where an error value came from, for the formula bar's explanations. The compiler records the first place in a
// formula that made an error rather than passing one on: a function, an operator, a name, a spill that was blocked,
// a cycle, or a cell the formula read that already held the error. The engine keeps one origin per cell with an
// error, so the formula bar can follow a chain of cells back to the first one.

import type { ErrorCode, Scalar } from '../values';

/** A cell on the page: the table's index on the page, the column, and the data row, all zero-based. */
export interface OriginCell {
  readonly table: number;
  readonly col: number;
  readonly row: number;
}

/** A summary of an argument that was not a single value. */
export interface ArgSummary {
  readonly rows: number;
  readonly cols: number;
}

export type OriginKind = 'function' | 'operator' | 'cell' | 'name' | 'spill' | 'cycle' | 'formula';

export interface ErrorOrigin {
  readonly code: ErrorCode;
  readonly kind: OriginKind;
  /** The function, the operator, or the name. */
  readonly name?: string;
  /** Where in the formula text the node starts and ends. */
  readonly start?: number;
  readonly end?: number;
  /** The arguments the function was given: single values as they were, arrays and ranges by their size. */
  readonly args?: readonly (Scalar | ArgSummary)[];
  /** For 'cell', the cell the error was read from; for 'spill', the cell that blocks the spill. */
  readonly cell?: OriginCell;
}

/**
 * Which sentence explains an origin. The engine holds no interface text: the formula bar keeps the sentences in its
 * strings file (app/src/strings/en) and passes `say`, which turns a key and its values into the sentence.
 */
export type OriginSentence =
  | 'function'
  | 'functionUnnamed'
  | 'operator'
  | 'cell'
  | 'cellUnknown'
  | 'name'
  | 'nameUnknown'
  | 'spill'
  | 'spillNoRoom'
  | 'cycle'
  | 'formula';

/** The values a sentence may use: the function, operator, or name, and the cell's display name. */
export interface OriginSentenceValues {
  readonly name?: string;
  readonly cell?: string;
}

/** The key and values for an origin's sentence. */
export function originSentence(
  origin: ErrorOrigin,
  cellName: (cell: OriginCell) => string,
): { key: OriginSentence; values: OriginSentenceValues } {
  switch (origin.kind) {
    case 'function':
      return origin.name ? { key: 'function', values: { name: origin.name } } : { key: 'functionUnnamed', values: {} };
    case 'operator':
      return { key: 'operator', values: { name: origin.name ?? '' } };
    case 'cell':
      return origin.cell
        ? { key: 'cell', values: { cell: cellName(origin.cell) } }
        : { key: 'cellUnknown', values: {} };
    case 'name':
      return origin.name ? { key: 'name', values: { name: origin.name } } : { key: 'nameUnknown', values: {} };
    case 'spill':
      return origin.cell
        ? { key: 'spill', values: { cell: cellName(origin.cell) } }
        : { key: 'spillNoRoom', values: {} };
    case 'cycle':
      return { key: 'cycle', values: {} };
    case 'formula':
      return { key: 'formula', values: {} };
  }
}

/** The plain sentence for an origin, as the formula bar shows it under the formula, in the strings `say` reads. */
export function explainOrigin(
  origin: ErrorOrigin,
  cellName: (cell: OriginCell) => string,
  say: (key: OriginSentence, values: OriginSentenceValues) => string,
): string {
  const { key, values } = originSentence(origin, cellName);
  return say(key, values);
}
