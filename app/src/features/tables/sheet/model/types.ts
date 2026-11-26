// The shapes of `data.sheet` (format spec 6.3). Every key is optional, and every object may hold keys this version
// does not know: the reader keeps them, so the types carry an index signature.

import type { Json, JsonObject } from './json';

export type Color = string;

export interface FontStyle {
  family?: string;
  size?: number;
  weight?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: string;
  strike?: 'single' | 'double' | 'none';
  color?: Color;
  script?: 'super' | 'sub' | 'none';
}

export type Fill =
  | Color
  | 'none'
  | { pattern: string; color?: Color; back?: Color }
  | { gradient: { angle?: number; stops: { at: number; color: Color }[] } };

export interface BorderSide {
  style: string;
  color?: Color;
  width?: number;
}

export interface Borders {
  t?: BorderSide;
  r?: BorderSide;
  b?: BorderSide;
  l?: BorderSide;
  du?: BorderSide;
  dd?: BorderSide;
}

export interface Align {
  h?: 'general' | 'left' | 'center' | 'right' | 'fill' | 'justify' | 'centerAcross' | 'distributed';
  v?: 'top' | 'middle' | 'bottom' | 'justify' | 'distributed';
  wrap?: 'wrap' | 'overflow' | 'clip';
  shrink?: boolean;
  rotate?: number | 'stacked';
  indent?: number;
  dir?: 'context' | 'ltr' | 'rtl';
}

export interface Pad {
  t?: number;
  r?: number;
  b?: number;
  l?: number;
}

/** A cell style of R-SHT-7. A missing key is inherited. */
export interface CellStyle {
  fmt?: string;
  font?: FontStyle;
  fill?: Fill;
  border?: Borders;
  align?: Align;
  pad?: Pad;
  protect?: { locked?: boolean; hideFormula?: boolean };
}

/** A change to a style: a value sets the property, `null` clears it. Objects name the properties inside them. */
export type StyleChange = {
  [K in keyof CellStyle]?: CellStyle[K] extends object | undefined
    ? K extends 'fill'
      ? Fill | null
      : { [P in keyof NonNullable<CellStyle[K]>]?: NonNullable<CellStyle[K]>[P] | null } | null
    : CellStyle[K] | null;
};

/** A range of R-SHT-22: a whole column, a whole row, or the box between two corner cells. */
export type SheetRange = { col: string } | { row: string } | { from: [string, string]; to: [string, string] };

export interface MergeEntry {
  from: [string, string];
  to: [string, string];
}

export interface NameEntry {
  ref: string;
  scope?: 'table' | 'page';
  comment?: string;
}

export type CachedValue = number | string | boolean | null | { e: string };

/** `data.sheet` as the reader keeps it: plain JSON that holds unknown keys and invalid values too. */
export type Sheet = JsonObject;

/** The table block data the model reads: the version 1 keys plus `smart` and `sheet`. */
export interface TableLike {
  header?: boolean;
  columns: readonly { id: string }[];
  rows: readonly { id: string; cells: Readonly<Record<string, { markdown: string }>> }[];
  smart?: unknown;
  sheet?: unknown;
}

/** A cell by its row and column IDs. */
export interface CellRef {
  row: string;
  col: string;
}

export type { Json, JsonObject };
