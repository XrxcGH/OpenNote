// Table editing in a table block's editor: cell selection, keys, and column widths (owner: WP6). WP0's factory adds
// nothing; the schema's table nodes come from editor/schema.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';

export function tableKitExtensions(_host: EditorHost): Extensions {
  return [];
}
