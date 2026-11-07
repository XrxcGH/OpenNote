// The comment actions the comments pane and the commands share (ADR 0086): go to a comment's text, resolve it, reopen
// it, and delete it. Deleting takes the marks off the text, and the rider drops the record in the same undo step.
import type { Editor } from '@tiptap/core';
import { t } from '../../strings/t';
import { showToast } from '../../ui';
import { selectRange } from './changes';
import { findRange, removeComment } from './comments';
import type { PageReview } from './page';

/** What a command says when it cannot do its job, or what it did: a toast that the screen reader also speaks. */
export function say(message: string): void {
  if (message) showToast({ message });
}

/** The editor of a block, mounted for a target if it is not mounted yet. */
export function editorFor(review: PageReview, block: string): Editor | null {
  const { pool } = review.mounted;
  return pool.editor(block) ?? pool.mount(block, null, 'target');
}

/** Selects comment `id`'s text in its block's editor. */
export function goToComment(review: PageReview, block: string, id: string): void {
  const editor = editorFor(review, block);
  const range = editor ? findRange(editor.state.doc, id) : null;
  if (!editor || !range) return;
  editor.view.dispatch(selectRange(editor.state, range.spans[0].from, range.spans[0].to));
  editor.view.focus();
}

export function setResolved(review: PageReview, block: string, id: string, resolved: boolean): void {
  review.send(block, { comments: { [id]: { resolved } } });
  say(t(resolved ? 'textReview.resolved' : 'textReview.reopenComment'));
}

/** Deletes a comment: its marks leave the text, and the rider drops its record in the same undo step. */
export function deleteComment(review: PageReview, block: string, id: string): void {
  const editor = editorFor(review, block);
  const tr = editor ? removeComment(editor.state, id) : null;
  if (editor && tr) editor.view.dispatch(tr);
}

/** A comment's place on the page, for going from one to the next: its block's place in reading order, then its own. */
export interface CommentPlace {
  index: number;
  pos: number;
}

/**
 * The comment after (or before) a place on the page, around the page: the first one when none comes after, the last
 * when none comes before. Null when there are none.
 */
export function nearest<T extends CommentPlace>(
  comments: readonly T[],
  here: CommentPlace,
  direction: 1 | -1,
): T | null {
  const order = (x: CommentPlace, y: CommentPlace) => x.index - y.index || x.pos - y.pos;
  const sorted = [...comments].sort(order);
  if (sorted.length === 0) return null;
  if (direction === 1) return sorted.find((one) => order(one, here) > 0) ?? sorted[0];
  return [...sorted].reverse().find((one) => order(one, here) < 0) ?? sorted[sorted.length - 1];
}
