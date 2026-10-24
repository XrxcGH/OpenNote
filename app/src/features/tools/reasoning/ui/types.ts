// What a reasoning tool tells the kit window: its modes, each a list of fields and a function from what was typed to
// an outcome. The window draws the fields, the answer, the steps, the tables, and the picture, and offers Insert.
import type { SvgNode } from '../core/svg';
import type { ReasoningToolId } from '../meta';

export interface Field {
  id: string;
  /** A one-line box, a text area, or a list to pick from. */
  kind?: 'text' | 'area' | 'select';
  initial?: string;
  /** The values of a select field. Their labels are the tool's options.<field>.<value> strings. */
  options?: readonly string[];
  rows?: number;
  /** Whether the tool's help.<field> string explains the box. */
  help?: boolean;
  /** Spans the whole row. Text areas always do. */
  wide?: boolean;
}

export type Values = Readonly<Record<string, string>>;

export interface Table {
  caption: string;
  header: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface Figure {
  svg: SvgNode;
  /** What the picture shows, in words. */
  alt: string;
}

export type Outcome =
  | {
      ok: true;
      answer: string;
      latex?: string;
      steps?: readonly string[];
      tables?: readonly Table[];
      figure?: Figure;
      note?: string;
    }
  | { ok: false; message: string };

export interface Mode {
  id: string;
  fields: readonly Field[] | ((values: Values) => readonly Field[]);
  solve(values: Values): Outcome;
}

export interface ToolSpec {
  id: ReasoningToolId;
  modes: readonly Mode[];
}
