// The text and table schemas, built once from the Tiptap extensions (PLAN.md section 3.3, owned by WP0). The
// editor kit uses the same extension list, so a document parsed here is a document an editor can mount.
import { getSchema, Node } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import type { Schema } from '@tiptap/pm/model';
import type { MarkName } from './constants';
import * as marks from './marks';
import * as nodes from './nodes';

export type TextNodeName =
  | 'doc'
  | 'paragraph'
  | 'heading'
  | 'bulletList'
  | 'orderedList'
  | 'listItem'
  | 'blockquote'
  | 'callout'
  | 'calloutTitle'
  | 'codeBlock'
  | 'horizontalRule'
  | 'mathBlock'
  | 'text'
  | 'hardBreak'
  | 'image'
  | 'mathInline';
export type TableNodeName =
  | 'doc'
  | 'table'
  | 'tableRow'
  | 'tableHeader'
  | 'tableCell'
  | 'paragraph'
  | 'text'
  | 'hardBreak'
  | 'image'
  | 'mathInline';

/** SPEC 7.7's marks, in nesting order, outermost first. */
export const markExtensions: Extensions = [
  marks.Link,
  marks.Bold,
  marks.Italic,
  marks.Strike,
  marks.Underline,
  marks.Highlight,
  marks.TextColor,
  marks.TextSize,
  marks.Subscript,
  marks.Superscript,
  marks.Code,
];

/** Nodes first, with the paragraph ahead of the other blocks so it is the default block. */
export const textExtensions: Extensions = [
  nodes.Doc,
  nodes.TextNode,
  nodes.Paragraph,
  nodes.Heading,
  nodes.HardBreak,
  nodes.HorizontalRule,
  nodes.Blockquote,
  nodes.ListItem,
  nodes.BulletList,
  nodes.OrderedList,
  nodes.CalloutTitle,
  nodes.Callout,
  nodes.CodeBlock,
  nodes.MathBlock,
  nodes.MathInline,
  nodes.ImageNode,
  ...markExtensions,
];

/** A table editor's document is one table. */
export const TableDoc = Node.create({ name: 'doc', topNode: true, content: 'table' });
/** A pasted cell's span as a whole number from 1 to 1000, so no other value reaches the table's layout. */
function spanOf(name: string) {
  return (element: HTMLElement): number => {
    const span = Number(element.getAttribute(name) ?? '1');
    return Number.isInteger(span) && span >= 1 && span <= 1000 ? span : 1;
  };
}

/** Tiptap's cells read their spans without a parse rule of their own, which lets any value through. */
const SPANS = {
  colspan: { default: 1, parseHTML: spanOf('colspan') },
  rowspan: { default: 1, parseHTML: spanOf('rowspan') },
};

/** A cell holds exactly one paragraph, because a table cell is one line of Markdown (SPEC 6.3). */
export const OneParagraphCell = TableCell.extend({
  content: 'paragraph',
  addAttributes() {
    return { ...this.parent?.(), ...SPANS };
  },
});
export const OneParagraphHeader = TableHeader.extend({
  content: 'paragraph',
  addAttributes() {
    return { ...this.parent?.(), ...SPANS };
  },
});

export const tableExtensions: Extensions = [
  TableDoc,
  Table.configure({ resizable: false }),
  TableRow,
  OneParagraphHeader,
  OneParagraphCell,
  nodes.Paragraph,
  nodes.TextNode,
  nodes.HardBreak,
  nodes.MathInline,
  nodes.ImageNode,
  ...markExtensions,
];

export const textSchema = getSchema(textExtensions) as Schema<TextNodeName, MarkName>;
export const tableSchema = getSchema(tableExtensions) as Schema<TableNodeName, MarkName>;
