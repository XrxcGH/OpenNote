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

/** The plain sentence for an origin, as the formula bar shows it under the formula. */
export function explainOrigin(origin: ErrorOrigin, cellName: (cell: OriginCell) => string): string {
  switch (origin.kind) {
    case 'function':
      return `${origin.name ?? 'A function'} gave this error.`;
    case 'operator':
      return `The ${origin.name ?? ''} operation gave this error.`;
    case 'cell':
      return origin.cell ? `The error comes from ${cellName(origin.cell)}.` : 'The error comes from another cell.';
    case 'name':
      return `${origin.name ?? 'A name'} isn't a function, a name, or a column.`;
    case 'spill':
      return origin.cell
        ? `${cellName(origin.cell)} is in the way of the results.`
        : "The results don't fit in the table.";
    case 'cycle':
      return 'This formula uses its own result.';
    case 'formula':
      return 'This formula gave this error.';
  }
}
