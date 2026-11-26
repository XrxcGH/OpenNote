// Gives every table block's editor row virtualization (DESIGN.md section 18). The table block's chunk imports this
// file, so the extension is registered before the first table editor is made, and start-up never loads it.
import { Extension } from '@tiptap/core';
import { editorExtensions } from '../../../../editor/extensions/kit';
import { setTableRowView } from '../../../../editor/table/rowViewSeam';
import { RowView, virtualRowsPlugin } from './plugin';

export const VIRTUAL_ROWS_EXTENSION = 'tables.virtualRows';

/** The editor extension: a plugin that draws only the rows near the view in tables of more than 2,000 rows. */
export const VirtualRows = Extension.create({
  name: 'virtualRows',
  addProseMirrorPlugins: () => [virtualRowsPlugin()],
});

if (!editorExtensions.get(VIRTUAL_ROWS_EXTENSION)) {
  // The row view goes in through the row node, so a table's first view already has its placeholders.
  setTableRowView(({ node, view, getPos, decorations }) => new RowView(node, view, getPos, decorations));
  editorExtensions.register({ id: VIRTUAL_ROWS_EXTENSION, order: 900, kinds: ['table'], create: () => VirtualRows });
}
