// What the selection is now (owner: WP4): active marks, the block kind, and whether a link is under the caret.
// The page's commands read these to show checked states and to decide whether a key applies. The module imports
// types only, so the start-up registrations can use it without loading the editor.
import type { Mark, MarkType, Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';

/** The marks at the caret, or of the selection's first character. */
function marksAtSelection(state: EditorState | Transaction): readonly Mark[] {
  const { selection } = state;
  const stored = 'storedMarks' in state ? state.storedMarks : null;
  if (selection.empty) return stored ?? selection.$from.marks();
  let found: readonly Mark[] | null = null;
  state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (found === null && node.isInline) found = node.marks;
    return found === null;
  });
  return found ?? selection.$from.marks();
}

function attrsMatch(mark: Mark, attrs: Record<string, unknown>): boolean {
  return Object.entries(attrs).every(([key, value]) => mark.attrs[key] === value);
}

/** Whether every character in the selection has the mark, or the caret will type with it. */
export function isMarkActive(state: EditorState, name: string, attrs?: Record<string, unknown>): boolean {
  const type = state.schema.marks[name] as MarkType | undefined;
  if (!type) return false;
  const matches = (mark: Mark) => mark.type === type && (!attrs || attrsMatch(mark, attrs));
  if (state.selection.empty) return marksAtSelection(state).some(matches);
  let all = true;
  let any = false;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node: PMNode) => {
    if (!node.isText) return true;
    any = true;
    if (!node.marks.some(matches)) all = false;
    return false;
  });
  return any && all;
}

/** The attributes of the mark at the selection, or null. */
export function markAttrs(state: EditorState, name: string): Record<string, unknown> | null {
  const mark = marksAtSelection(state).find((candidate) => candidate.type.name === name);
  return mark ? mark.attrs : null;
}

/** Whether the selection starts in a link. */
export function caretInLink(state: EditorState): boolean {
  const { $from } = state.selection;
  const has = (marks: readonly Mark[]) => marks.some((mark) => mark.type.name === 'link');
  return has($from.marks()) || has($from.nodeAfter?.marks ?? []);
}

/** Whether the selection has text in it, or the caret is in a link: when Ctrl+K edits a link. */
export function linkApplies(state: EditorState): boolean {
  return !state.selection.empty || caretInLink(state);
}

export type BlockKindName =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'bulletList'
  | 'orderedList'
  | 'checklist'
  | 'quote'
  | 'callout'
  | 'codeBlock';

/** The kind of block the caret is in, innermost container first: a task, a list, a quote, a callout. */
export function blockKindAt(state: EditorState): BlockKindName | null {
  const { $from } = state.selection;
  const parent = $from.parent;
  if (parent.type.name === 'codeBlock') return 'codeBlock';
  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const name = node.type.name;
    if (name === 'listItem') {
      if (node.attrs.checked !== null && node.attrs.checked !== undefined) return 'checklist';
      const list = $from.node(depth - 1).type.name;
      return list === 'orderedList' ? 'orderedList' : 'bulletList';
    }
    if (name === 'blockquote') return 'quote';
    if (name === 'callout') return 'callout';
  }
  if (parent.type.name === 'heading') return `heading${parent.attrs.level as 1 | 2 | 3 | 4 | 5 | 6}`;
  return parent.type.name === 'paragraph' ? 'paragraph' : null;
}

/** Whether the caret's textblock allows marks: code blocks and math don't. */
export function marksAllowed(state: EditorState): boolean {
  const { $from } = state.selection;
  return $from.parent.isTextblock && $from.parent.type.spec.code !== true;
}

/** Whether the caret is in a task item's first paragraph, where Check or uncheck applies. */
export function inTaskItem(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  for (const $pos of [$from, $to]) {
    const item = $pos.depth > 1 ? $pos.node(-1) : null;
    if (item?.type.name === 'listItem' && item.attrs.checked !== null && $pos.index(-1) === 0) return true;
  }
  return false;
}

/** The event an editor sends when Backspace at its very start should merge it into the text block above. */
export const MERGE_BLOCKS_EVENT = 'opennote:mergeblocks';

export interface MergeBlocksDetail {
  /** The block whose text moves up. */
  block: string;
  /** The text block above, which keeps the merged text. */
  previous: string;
}

/** The event an editor sends when "/" opens a slash menu session, with the session as its detail. */
export const SLASH_MENU_EVENT = 'opennote:slashmenu';
