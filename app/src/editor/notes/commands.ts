// The note commands that work on an editor or on the model (ADR 0087): insert a reference to a new note, find the
// reference at the caret, put the caret after a reference, and convert notes between footnotes and endnotes.
import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { newId } from '../ids';
import { META_COMMAND } from '../meta';
import type { NotesModel, NotesPatch } from './model';
import type { NoteKind } from './refs';

/**
 * Inserts a reference to a new, empty note right after the selection, as Word does, and returns the note's ID. The
 * model hands the note to the text sync, which sends it in the same step as the reference. Null where an inline
 * atom can't go, such as in a code block.
 */
export function insertNote(editor: Editor, model: NotesModel, kind: NoteKind): string | null {
  const { state } = editor;
  const at = state.selection.to;
  const $at = state.doc.resolve(at);
  const type = state.schema.nodes.footnoteRef;
  if (!type || !$at.parent.isTextblock || !$at.parent.type.contentMatch.matchType(type)) return null;
  if ($at.parent.type.spec.code) return null;
  const id = newId();
  const node = type.create({ id }, null, $at.marks());
  model.expect(id, kind);
  const tr = state.tr.insert(at, node);
  tr.setSelection(TextSelection.create(tr.doc, at + node.nodeSize));
  tr.setMeta(META_COMMAND, true);
  editor.view.dispatch(tr.scrollIntoView());
  return id;
}

/** The note ID of the reference that is selected, or right before or after the caret, or null. */
export function refAtCaret(editor: Editor): string | null {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection && selection.node.type.name === 'footnoteRef') {
    return String(selection.node.attrs.id);
  }
  const { $from } = selection;
  for (const node of [$from.nodeBefore, $from.nodeAfter]) {
    if (node?.type.name === 'footnoteRef') return String(node.attrs.id);
  }
  return null;
}

/** The position right after the reference to `id`, or null. */
export function refEnd(editor: Editor, id: string): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === 'footnoteRef' && node.attrs.id === id) found = pos + node.nodeSize;
    return !node.isLeaf;
  });
  return found;
}

/** Puts the caret right after the reference to `id` and shows it. Returns whether the reference was found. */
export function caretAfterRef(editor: Editor, id: string): boolean {
  const at = refEnd(editor, id);
  if (at === null) return false;
  editor.chain().focus().setTextSelection(at).scrollIntoView().run();
  return true;
}

/**
 * The patches, per block, that make notes of kind `from` into kind `to`: every such note on the page, or only the
 * note `only`. Each patch changes only `kind`, so the text stays as it is.
 */
export function conversionPatches(
  model: NotesModel,
  from: NoteKind | null,
  only: string | null = null,
): Map<string, NotesPatch> {
  const out = new Map<string, NotesPatch>();
  for (const block of model.blocks()) {
    const patch: NotesPatch = {};
    for (const [id, note] of Object.entries(model.of(block))) {
      if (only !== null ? id !== only : note.kind !== from) continue;
      patch[id] = { kind: note.kind === 'foot' ? 'end' : 'foot' };
    }
    if (Object.keys(patch).length > 0) out.set(block, patch);
  }
  return out;
}
