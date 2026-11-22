// The code block with the selection, on its own so start-up code can ask without loading the language list.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

/** The code block with the selection, and the position before it. Null outside code. */
export function codeBlockAt(state: EditorState): { node: PMNode; pos: number } | null {
  const { $from, $to } = state.selection;
  if ($from.parent.type.name !== 'codeBlock' || !$from.sameParent($to)) return null;
  return { node: $from.parent, pos: $from.before() };
}
