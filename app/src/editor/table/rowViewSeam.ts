// The node view of a table row (DESIGN.md section 18). Row virtualization (features/page/tables/virtual) sets it,
// so a table of thousands of rows draws only the rows near the view. Tiptap makes an editor's first view before
// its plugins are in, so a plugin's node view would come after every row was drawn once; the row node asks here.
import type { NodeViewRenderer } from '@tiptap/core';

let rowView: NodeViewRenderer | null = null;

/** Sets the row node view of editors made from now on. Returns a function that takes it away again. */
export function setTableRowView(view: NodeViewRenderer): () => void {
  rowView = view;
  return () => {
    if (rowView === view) rowView = null;
  };
}

/** The row node view, or null for ProseMirror's own rows. */
export function tableRowView(): NodeViewRenderer | null {
  return rowView;
}
