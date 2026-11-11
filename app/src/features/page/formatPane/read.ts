// Reading what the selection has, for the Format pane's fields: one value when every run or paragraph agrees,
// 'mixed' when they differ, '' when none has it.
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { selectionParaTargets } from '../../../editor/commands/paragraph';
import { paraFormat } from '../../../editor/paragraph/attributes';
import type { ParaFormat } from '../../../editor/paragraph/attributes';

export type Shown = string | boolean | 'mixed';

/** The marks of the text the selection covers; the caret's marks for a caret. One list per text node. */
function markLists(state: EditorState): (readonly Mark[])[] {
  const { selection } = state;
  if (selection.empty) return [state.storedMarks ?? selection.$from.marks()];
  const lists: (readonly Mark[])[] = [];
  for (const range of selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node: PMNode) => {
      if (node.isText) lists.push(node.marks);
      return true;
    });
  }
  return lists.length > 0 ? lists : [selection.$from.marks()];
}

/** The value of a mark's attribute over the selection. A mark without that attribute gives '1'. */
export function runValue(state: EditorState, mark: string, key: string | null): string {
  const seen = new Set<string>();
  for (const marks of markLists(state)) {
    const found = marks.find((candidate) => candidate.type.name === mark);
    seen.add(found ? String((key ? found.attrs[key] : null) ?? '1') : '');
  }
  if (seen.size > 1) return 'mixed';
  return [...seen][0] ?? '';
}

/** The marks of the selection's first text, for fields that combine several attributes. */
export function firstMark(state: EditorState, mark: string): Mark | undefined {
  return markLists(state)[0]?.find((candidate) => candidate.type.name === mark);
}

/** A paragraph value over the selected elements, written as text. */
export function paraValue(state: EditorState, pick: (format: ParaFormat) => string | undefined): string {
  const seen = new Set(
    selectionParaTargets(state.doc, state.selection).map(({ node }) => pick(paraFormat(node.attrs)) ?? ''),
  );
  if (seen.size > 1) return 'mixed';
  return [...seen][0] ?? '';
}
