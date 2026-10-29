// Types for the flow paginator. The paginator never reads the DOM. The caller describes the flow as blocks and gives
// a measure function that returns each block's boxes in natural coordinates. Those are the positions in the page's
// coordinate space as if no spacer had been inserted yet.

/** A vertical extent in page units. */
export interface Box {
  readonly top: number;
  readonly height: number;
}

/**
 * What a block looks like on screen. A text block lists its visual lines and a table lists its rows. Without them,
 * the block is one piece that never splits.
 */
export interface BlockMeasure extends Box {
  readonly lines?: readonly Box[];
  readonly rows?: readonly Box[];
}

/**
 * One flowing block, in reading order.
 * - `text`: a paragraph, list, callout, quote, or code block. It splits between lines.
 * - `table`: it splits between rows, and keeps together by default.
 * - `atom`: an image or another block that never splits.
 * - `break`: a manual page break. The next block starts a new sheet, and the break itself takes no room.
 */
export interface FlowBlock {
  readonly id: string;
  readonly kind: 'text' | 'table' | 'atom' | 'break';
  /** A heading keeps with the block after it, so a heading never ends a sheet. */
  readonly heading?: boolean;
  /** Moves the whole block to the next sheet when it doesn't fit. Tables default to true, other blocks to false. */
  readonly keepTogether?: boolean;
  /** How many rows at the top of a table are a header, repeated after a break. */
  readonly headerRows?: number;
}

/** Returns the block's boxes. The paginator calls it once per block. */
export type Measure = (block: FlowBlock) => BlockMeasure;

/** Where a sheet starts: before a block, before one line of a text block, or before one row of a table. */
export type BreakPos =
  | { readonly kind: 'block'; readonly block: string }
  | { readonly kind: 'line'; readonly block: string; readonly line: number }
  | { readonly kind: 'row'; readonly block: string; readonly row: number };

export interface SheetBreak {
  /** The sheet that starts here. */
  readonly sheet: number;
  readonly pos: BreakPos;
  /** The spacer height in page units: how far everything from here on moves down. It includes `headerHeight`. */
  readonly push: number;
  /** True for a manual page break, false for one the paginator chose. */
  readonly forced: boolean;
  /** True when the table's header rows repeat at the top of the new sheet. */
  readonly repeatHeader: boolean;
  /** The height of the repeated header rows, which is part of `push`. Zero when they don't repeat. */
  readonly headerHeight: number;
}

/**
 * Something the plan could not do. A `tooTall` piece is taller than a content box, so it is clipped at the bottom.
 * With `noRoom`, the margins leave no content box, so the whole flow stays on one sheet. With `stopped`, the paginator
 * made more breaks than any flow needs and stopped before `block`. That is a safety net for a bug, and the rest of the
 * flow stays where it is.
 */
export interface PlanWarning {
  readonly kind: 'tooTall' | 'noRoom' | 'stopped';
  readonly block: string;
  readonly sheet: number;
}

export interface Plan {
  /** How many sheets the flow needs, at least 1. A manual break at the very end adds a sheet. */
  readonly sheets: number;
  readonly breaks: readonly SheetBreak[];
  readonly warnings: readonly PlanWarning[];
  /** The y of the flow's last bottom edge once every spacer is in place. */
  readonly end: number;
}

export interface PaginateOptions {
  /** The fewest lines of a split paragraph that may sit alone at the bottom or the top of a sheet. Default 2. */
  readonly minLines?: number;
}
