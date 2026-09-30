// The text block schema, built once from the Tiptap extensions. The editor uses the same extension list, so a
// document parsed here is a document the editor can mount.
import { getSchema } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import * as marks from './marks';
import * as nodes from './nodes';

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

export const textSchema: Schema = getSchema(textExtensions);
