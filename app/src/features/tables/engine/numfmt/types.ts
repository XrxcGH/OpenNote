// The shapes of a compiled number format code (ADR 0057). A code is stored in the invariant (en-US) form that .xlsx
// files use (ECMA-376 Part 1, 18.8.31) and compiled once into sections of tokens.

/** One piece of a section, in the order it was written. */
export type Token =
  | { t: 'lit'; s: string }
  /** A digit placeholder: `0` shows a zero, `#` shows nothing, `?` shows a space. */
  | { t: 'digit'; c: '0' | '#' | '?' }
  /** A run of digits 1 to 9 (and the zeros after them), such as the fixed denominator in `# ?/16`. */
  | { t: 'num'; s: string }
  | { t: 'point' }
  | { t: 'comma' }
  | { t: 'percent' }
  | { t: 'exp'; upper: boolean; plus: boolean }
  | { t: 'slash' }
  | { t: 'at' }
  /** `_x`: a space as wide as x. */
  | { t: 'skip'; c: string }
  /** `*x`: x repeated to fill the cell. */
  | { t: 'fill'; c: string }
  | { t: 'general' }
  | { t: 'date'; k: DateKind; n: number; text: string };

export type DateKind =
  | 'y'
  | 'm'
  | 'd'
  | 'h'
  | 's'
  /** Minutes: an `m` or `mm` read as minutes by the rule in ECMA-376 18.8.31. */
  | 'min'
  | 'ampm'
  | 'ap'
  /** Elapsed hours, minutes, and seconds: `[h]`, `[mm]`, `[ss]`. */
  | 'eh'
  | 'em'
  | 'es'
  /** Fractional seconds: `.0` to `.000` after the seconds. */
  | 'frac';

export type Comparison = '<' | '<=' | '>' | '>=' | '=' | '<>';

export interface Condition {
  op: Comparison;
  value: number;
}

export type SectionKind = 'number' | 'date' | 'text';

export interface Section {
  kind: SectionKind;
  tokens: Token[];
  /** A color token: one of the eight names, or `colorN` for the indexed colors 1 to 56. */
  color: string | null;
  condition: Condition | null;
  /** The locale of a `[$-407]` or `[$€-407]` tag, as a BCP 47 tag, for month and day names. */
  locale: string | null;
  /** `[$-F800]` (the region's long date) or `[$-F400]` (the region's time). */
  system: 'longDate' | 'time' | null;
  /** True when the section is empty, which hides the value. */
  empty: boolean;
}

export interface Compiled {
  code: string;
  sections: Section[];
  /** The section for text, when the code has one. */
  text: Section | null;
}

export type CompileError = 'sections' | 'quote' | 'bracket' | 'escape' | 'condition';

export type CompileResult = { ok: true; compiled: Compiled } | { ok: false; error: CompileError };

/** What a cell shows. */
export interface Rendered {
  text: string;
  /** The color token of the section, or null for the cell's own color. */
  color: string | null;
  /**
   * A `*x` fill: the character repeats at `at` (an index into `text`) until the text fills the cell, so accounting
   * formats show the symbol on the left and the digits on the right.
   */
  fill: { char: string; at: number } | null;
  /** True when a number cannot fit and the text is a row of `#`, as spreadsheets show. */
  overflow: boolean;
}
