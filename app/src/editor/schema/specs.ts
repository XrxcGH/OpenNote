// The schema as data (PLAN.md section 3.3, owned by WP0). It holds the shared constants, a spec for each node
// and mark of both schemas, and the data a table block stores. The specs come from the Tiptap extensions in
// nodes.ts and marks.ts, so the static schema and the editor kit can't drift apart.
import type { MarkSpec, NodeSpec, Schema } from '@tiptap/pm/model';
import type { MarkName } from './constants';
import { HIGHLIGHT_COLORS, MARK_ORDER, TEXT_SIZES } from './constants';
import { tableSchema, textSchema } from './schema';
import type { TableNodeName, TextNodeName } from './schema';

export * from './constants';
export type { TableNodeName, TextNodeName } from './schema';

/** A highlight's color. Null in the attribute means Honey, the default. */
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
export type TextSizeName = (typeof TEXT_SIZES)[number];

/** A table block's data (SPEC 6.3). */
export interface TableData {
  header: boolean;
  columns: { id: string; width: number }[];
  rows: { id: string; cells: Record<string, { markdown: string }> }[];
}

/** A new table column's width, in page units (SPEC 2.6). */
export const DEFAULT_COLUMN_WIDTH = 160;

function nodeSpecsOf<N extends string>(schema: Schema<N, MarkName>): Readonly<Record<N, NodeSpec>> {
  const specs = {} as Record<N, NodeSpec>;
  schema.spec.nodes.forEach((name, spec) => {
    specs[name as N] = spec;
  });
  return Object.freeze(specs);
}

export const nodeSpecs: Readonly<Record<TextNodeName, NodeSpec>> = nodeSpecsOf(textSchema);
export const tableNodeSpecs: Readonly<Record<TableNodeName, NodeSpec>> = nodeSpecsOf(tableSchema);
export const markSpecs: Readonly<Record<MarkName, MarkSpec>> = Object.freeze(
  Object.fromEntries(MARK_ORDER.map((name) => [name, textSchema.marks[name].spec])) as Record<MarkName, MarkSpec>,
);
