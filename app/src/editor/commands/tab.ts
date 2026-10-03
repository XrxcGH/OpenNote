// Tab and Shift+Tab in text (ARCHITECTURE.md section 22.4; owner: WP4). Tab stays inside the editor, as in OneNote
// and Word, and Escape is the way out.
//
// - In a list item, Tab sinks it into the previous item, and Shift+Tab lifts it, to a paragraph at the top level.
// - A plain paragraph with the caret at its start, or several selected paragraphs, become a bulleted list. They
//   join the list just above as new items.
// - Anywhere else, Tab types a tab character and Shift+Tab does nothing.
// Code blocks and table cells have their own Tab keys, so these commands don't apply there.
import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import type { EditorState } from '@tiptap/pm/state';
import { ancestorDepth, fromChange, selectedTextblocks, viaCommand } from './command';
import type { Command } from './command';
import { turnIntoChange } from './turnInto';

/** What Tab did, for the announcement. */
export type TabResult = 'indented' | 'outdented' | 'bulleted' | 'numbered' | 'tab' | 'paragraph' | 'none';

/** Whether Tab belongs to someone else here: code blocks and table cells. */
export function tabOwnedElsewhere(state: EditorState): boolean {
  const { $from } = state.selection;
  return $from.parent.type.spec.code === true || ancestorDepth($from, ['tableCell', 'tableHeader']) >= 0;
}

function inListItem(state: EditorState): boolean {
  return ancestorDepth(state.selection.$from, ['listItem']) >= 0;
}

/** Whether Tab makes a list here: a paragraph with the caret at its start, or several paragraphs selected. */
function startsList(state: EditorState): boolean {
  const { selection } = state;
  const { $from } = selection;
  if ($from.parent.type.name !== 'paragraph' || inListItem(state)) return false;
  if (selection.empty) return $from.parentOffset === 0;
  const blocks = selectedTextblocks(state.tr);
  return blocks.length > 1 && blocks.every(({ node }) => node.type.name === 'paragraph');
}

/** The kind of list just above the selection's first block, or null. */
function listAbove(state: EditorState): 'bulletList' | 'orderedList' | null {
  const { $from } = state.selection;
  const index = $from.index($from.depth - 1);
  if (index === 0) return null;
  const before = $from.node($from.depth - 1).child(index - 1).type.name;
  return before === 'bulletList' || before === 'orderedList' ? before : null;
}

/** What Tab will do at the selection. */
export function tabResult(state: EditorState, shift: boolean): TabResult {
  if (tabOwnedElsewhere(state)) return 'none';
  if (inListItem(state)) return shift ? 'outdented' : 'indented';
  if (shift) return 'none';
  if (startsList(state)) return listAbove(state) === 'orderedList' ? 'numbered' : 'bulleted';
  return 'tab';
}

/** Tab: indents a list item, starts or joins a list, or types a tab character. */
export function indent(): Command {
  return (state, dispatch) => {
    const result = tabResult(state, false);
    if (result === 'none') return false;
    const listItem = state.schema.nodes.listItem;
    if (result === 'indented') {
      // The first item can't sink; Tab still stays in the editor.
      sinkListItem(listItem)(state, dispatch);
      return true;
    }
    if (result === 'tab') {
      dispatch?.(state.tr.insertText('\t').scrollIntoView());
      return true;
    }
    const kind = result === 'numbered' ? 'orderedList' : 'bulletList';
    return fromChange(turnIntoChange(kind))(state, dispatch);
  };
}

/** Shift+Tab: lifts a list item a level, to a paragraph at the top. Elsewhere, nothing. */
export function outdent(): Command {
  return (state, dispatch) => {
    const result = tabResult(state, true);
    if (result === 'none') return !tabOwnedElsewhere(state);
    return fromChange(viaCommand(liftListItem(state.schema.nodes.listItem)))(state, dispatch) || true;
  };
}
