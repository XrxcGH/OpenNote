// Insert equation and Insert inline equation (Phase 10). An inline equation takes the selected text as its LaTeX;
// both open the source field at once, so typing the equation is the next thing that happens.
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { openMathAt } from '../../editor/extensions/math';
import { META_COMMAND } from '../../editor/meta';

/** Puts an empty equation at the caret and opens its field. False when this editor has no math. */
export function insertMath(editor: Editor, display: boolean): boolean {
  const type = editor.schema.nodes[display ? 'mathBlock' : 'mathInline'];
  if (!type || !editor.isEditable) return false;
  const { state } = editor;
  const { from, to } = state.selection;
  const source = display ? '' : state.doc.textBetween(from, to, ' ').trim();
  const node = type.create({ source });
  const tr = state.tr.replaceSelectionWith(node, false).setMeta(META_COMMAND, true);
  let end: number | null = null;
  tr.mapping.maps[tr.steps.length - 1]?.forEach((_from, _to, _newFrom, newTo) => {
    end ??= newTo;
  });
  const pos = (end ?? tr.selection.to) - node.nodeSize;
  if (tr.doc.nodeAt(pos)?.type !== type) return false;
  editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
  editor.view.focus();
  return openMathAt(editor, pos);
}
