// Comments in a text block's document (ADR 0086). A comment's range is its `comment` marks, so the range follows its
// text through every edit. Several comments may cover the same text (R-MRK-26). These are the editor-level steps;
// page.ts sends the records.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { META_COMMAND } from '../../editor/meta';
import { commentRanges } from './ranges';
import type { Ranged } from './ranges';
import { REVIEW_META } from './suggest';

const WORD = /[\p{L}\p{N}\p{M}_'’-]/u;

/** The word around a caret, as Word comments the word at the caret when nothing is selected; null between words. */
export function wordAround(state: EditorState): { from: number; to: number } | null {
  const { $from } = state.selection;
  const parent = $from.parent;
  if (!parent.isTextblock) return null;
  const text = parent.textBetween(0, parent.content.size, '￼', '￼');
  let start = $from.parentOffset;
  let end = start;
  while (start > 0 && WORD.test(text[start - 1])) start--;
  while (end < text.length && WORD.test(text[end])) end++;
  if (start === end) return null;
  const base = $from.start();
  return { from: base + start, to: base + end };
}

/** The range a new comment covers: the selection, or the word at the caret. Null when there is no text to comment. */
export function commentTarget(state: EditorState): { from: number; to: number } | null {
  const { from, to, empty } = state.selection;
  if (!empty) return state.doc.textBetween(from, to, '', '￼').trim().length > 0 ? { from, to } : null;
  return wordAround(state);
}

/** The transaction that puts comment `id` over `range`, or null where comments cannot go (a code block). */
export function addComment(state: EditorState, id: string, range: { from: number; to: number }): Transaction | null {
  const type = state.schema.marks.comment;
  const tr = state.tr.addMark(range.from, range.to, type.create({ comment: id }));
  if (!tr.docChanged) return null;
  return tr.setMeta(REVIEW_META, true).setMeta(META_COMMAND, true);
}

/** The transaction that takes comment `id`'s marks off its text, or null when the document has none. */
export function removeComment(state: EditorState, id: string): Transaction | null {
  const mark = state.schema.marks.comment.create({ comment: id });
  const range = commentRanges(state.doc).find((one) => one.id === id);
  if (!range) return null;
  const tr = state.tr;
  for (const span of range.spans) tr.removeMark(span.from, span.to, mark);
  return tr.setMeta(REVIEW_META, true).setMeta(META_COMMAND, true);
}

/** The comment `id` in a document, or null. */
export function findRange(doc: PMNode, id: string): Ranged | null {
  return commentRanges(doc).find((range) => range.id === id) ?? null;
}

/** The comments at a position, innermost (latest ID) first. */
export function commentsAt(doc: PMNode, pos: number): string[] {
  return commentRanges(doc)
    .filter((range) => range.spans.some((span) => span.from <= pos && pos <= span.to))
    .map((range) => range.id)
    .sort()
    .reverse();
}
