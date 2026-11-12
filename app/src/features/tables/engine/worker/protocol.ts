// Messages between the page and the recalculation worker (ADR 0065). Tables cross as plain data; the worker answers
// with the cells whose values changed, so the page applies them in one transaction without an undo step.

import type { Table } from '../model';
import type { Scalar } from '../values';

export interface RecalcRequest {
  readonly id: number;
  readonly tables: readonly Table[];
  /** Today as a serial, read on the page, so TODAY() agrees with it. */
  readonly today: number;
  /** The page's title, read on the page, so CELL("filename") agrees with it. */
  readonly title?: string;
}

/** One changed cell: the table's index on the page, the data row, and the column. */
export interface CellChange {
  readonly table: number;
  readonly row: number;
  readonly col: number;
  readonly value: Scalar;
  /** The value comes from a spill. */
  readonly spill?: true;
}

export interface RecalcReply {
  readonly id: number;
  readonly changes: readonly CellChange[];
}
