// Code block commands (ARCHITECTURE.md sections 10.2, 14, and 22.4; owner: WP6), as ProseMirror commands. Tab and
// Shift+Tab indent and outdent the caret's line or the selected lines by the block's indent width. Enter keeps the
// line's indent. Three Enters at the end, Arrow Down at the end of the last block, or Ctrl+Enter leave the block.
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { findLanguage } from '../highlight/languages';
import { META_COMMAND } from '../meta';
import { LANGUAGE_PATTERN } from '../schema/constants';

type Dispatch = ((tr: Transaction) => void) | undefined;
export type Command = (state: EditorState, dispatch?: Dispatch, view?: EditorView) => boolean;

/** The code block with the selection, and the position before it. Null outside code. */
export function codeBlockAt(state: EditorState): { node: PMNode; pos: number } | null {
  const { $from, $to } = state.selection;
  if ($from.parent.type.name !== 'codeBlock' || !$from.sameParent($to)) return null;
  return { node: $from.parent, pos: $from.before() };
}

/**
 * The block's indent: a tab when a line starts with one, else the smallest indent its lines use (2 or 4 spaces),
 * else its language's usual indent.
 */
export function indentUnit(text: string, language: string | null): string {
  let smallest = Infinity;
  for (const line of text.split('\n')) {
    if (line.startsWith('\t')) return '\t';
    const spaces = /^ +(?=\S)/.exec(line)?.[0].length ?? 0;
    if (spaces > 0) smallest = Math.min(smallest, spaces);
  }
  if (smallest === 2 || smallest === 3) return '  ';
  if (smallest !== Infinity) return '    ';
  return ' '.repeat(findLanguage(language)?.indent ?? 4);
}

/** The start offsets, within the block's text, of the lines the selection touches. */
function selectedLineStarts(text: string, from: number, to: number): number[] {
  const starts: number[] = [];
  let start = text.lastIndexOf('\n', from - 1) + 1;
  for (;;) {
    starts.push(start);
    const next = text.indexOf('\n', start);
    if (next === -1 || next + 1 > to || (next + 1 === to && to > from)) break;
    start = next + 1;
  }
  return starts;
}

/** Indents (1) or outdents (-1) the caret's line or the selected lines by the block's indent width. */
export function indentCode(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const at = codeBlockAt(state);
    if (!at) return false;
    const text = at.node.textContent;
    const offset = at.pos + 1;
    const unit = indentUnit(text, at.node.attrs.language as string | null);
    const { from, to } = state.selection;
    const starts = selectedLineStarts(text, from - offset, to - offset);
    const tr = state.tr;
    // Last line first, so earlier offsets stay right.
    for (const start of [...starts].reverse()) {
      if (direction > 0) {
        if (text.indexOf('\n', start) !== start || starts.length === 1) tr.insertText(unit, offset + start);
        continue;
      }
      const lead = /^[ \t]*/.exec(text.slice(start))?.[0] ?? '';
      const remove = lead.startsWith('\t') ? 1 : Math.min(lead.length, unit === '\t' ? 4 : unit.length);
      if (remove > 0) tr.delete(offset + start, offset + start + remove);
    }
    if (!tr.docChanged) return direction < 0;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** Enter: a new line with the same indent as the caret's line. */
export const newlineKeepIndent: Command = (state, dispatch) => {
  const at = codeBlockAt(state);
  if (!at) return false;
  const { $from } = state.selection;
  const before = $from.parent.textBetween(0, $from.parentOffset);
  const indent = /^[ \t]*/.exec(before.slice(before.lastIndexOf('\n') + 1))?.[0] ?? '';
  dispatch?.(state.tr.insertText(`\n${indent}`).scrollIntoView());
  return true;
};

/** Adds an empty textblock after the code block at `pos` and puts the caret in it. False where none fits. */
function leaveAfter(tr: Transaction, pos: number): boolean {
  const $pos = tr.doc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const type = parent.contentMatchAt(index + 1).defaultType;
  if (!type?.isTextblock || !parent.canReplaceWith(index + 1, index + 1, type)) return false;
  const after = pos + parent.child(index).nodeSize;
  tr.insert(after, type.create());
  tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView();
  return true;
}

/** Leaves the code block for a new paragraph below it (Ctrl+Enter). */
export const leaveCode: Command = (state, dispatch) => {
  const at = codeBlockAt(state);
  if (!at) return false;
  const tr = state.tr.setMeta(META_COMMAND, true);
  if (!leaveAfter(tr, at.pos)) return false;
  dispatch?.(tr);
  return true;
};

/** The third Enter at the end of a block whose last two lines are blank leaves the block and drops them. */
export const tripleEnterLeave: Command = (state, dispatch) => {
  const at = codeBlockAt(state);
  if (!at || !state.selection.empty) return false;
  const { $from } = state.selection;
  if ($from.parentOffset !== $from.parent.content.size) return false;
  const text = at.node.textContent;
  const blank = /\n[ \t]*\n[ \t]*$/.exec(text);
  if (!blank) return false;
  const tr = state.tr.delete(at.pos + 1 + blank.index, at.pos + 1 + text.length);
  if (!leaveAfter(tr, at.pos)) return false;
  dispatch?.(tr);
  return true;
};

/** Arrow Down on the last line of a code block that ends its text box: a new paragraph below to move into. */
export const arrowDownLeave: Command = (state, dispatch, view) => {
  const at = codeBlockAt(state);
  if (!at || !state.selection.empty) return false;
  if (at.pos + at.node.nodeSize !== state.doc.content.size) return false;
  const lastLine = view
    ? view.endOfTextblock('down')
    : !at.node.textContent.slice(state.selection.$head.parentOffset).includes('\n');
  if (!lastLine) return false;
  const tr = state.tr;
  if (!leaveAfter(tr, at.pos)) return false;
  dispatch?.(tr);
  return true;
};

/** A tidy info string: what the picker chose, or null for plain text. */
export function cleanLanguage(language: string | null): string | null {
  const value = language?.trim() ?? '';
  return LANGUAGE_PATTERN.test(value) ? value : null;
}

/** Sets the language of the code block at `pos`. */
export function setCodeLanguage(pos: number, language: string | null): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (node?.type.name !== 'codeBlock') return false;
    const next = cleanLanguage(language);
    if ((node.attrs.language ?? null) === next) return false;
    dispatch?.(state.tr.setNodeAttribute(pos, 'language', next).setMeta(META_COMMAND, true));
    return true;
  };
}
