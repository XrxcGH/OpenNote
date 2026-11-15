// What the Review tab's commands do (ADR 0086), in a module that loads when one runs. registrations/review.ts
// declares the commands. Each works on the shown page. A new comment covers the selection, or the word at the caret.
// The comment commands act on the comment at the caret. Accept and Reject act on the change at the caret, on all
// changes, or on one author's changes.
import type { Editor } from '@tiptap/core';
import { newId } from '../../editor/ids';
import { META_COMMAND } from '../../editor/meta';
import { t } from '../../strings/t';
import { openMenu } from '../../ui';
import { shownMounted, targetEditor } from '../page';
import { decide, nextChange, pick, selectRange } from './changes';
import type { Decision, Which } from './changes';
import { addComment, commentTarget, commentsAt } from './comments';
import { findSuggestion, stageComment } from './model';
import { deleteComment, editorFor, goToComment, nearest, say, setResolved } from './actions';
import { closePane, focusComment, isPaneOpen, openPane } from './pane';
import { pageReview } from './page';
import type { PageReview } from './page';
import { stamp } from './records';
import type { CommentJson } from './records';
import { authorName, setReviewPrefs, suggesting } from './state';
import type { Markup } from './state';

function shown(): { review: PageReview; editor: Editor | null } | null {
  const mounted = shownMounted.get();
  const review = mounted ? pageReview(mounted) : null;
  return review ? { review, editor: targetEditor() } : null;
}

export function newComment(): void {
  const found = shown();
  if (!found?.editor) return say(t('textReview.needsText'));
  const { editor, review } = found;
  const block = review.blockOf(editor);
  const range = commentTarget(editor.state);
  if (!block || !range) return say(t('textReview.needsSelection'));
  const id = newId();
  const record: CommentJson = { author: authorName(), time: stamp(), markdown: '', replies: [], resolved: false };
  stageComment(id, record);
  const tr = addComment(editor.state, id, range);
  if (!tr) return say(t('textReview.cannotHere'));
  editor.view.dispatch(tr);
  openPane(review);
  focusComment(id);
}

export function toggleComments(): void {
  const found = shown();
  if (!found) return say(t('textReview.needsText'));
  if (isPaneOpen()) closePane();
  else openPane(found.review);
}

/** The place of the caret on the page: its block's index in reading order and its position there. */
function caretPlace(review: PageReview, editor: Editor | null): { index: number; pos: number } {
  const block = editor ? review.blockOf(editor) : null;
  const index = block ? review.docs().findIndex((one) => one.id === block) : -1;
  return { index, pos: editor?.state.selection.from ?? 0 };
}

export function moveToComment(direction: 1 | -1): void {
  const found = shown();
  if (!found) return say(t('textReview.needsText'));
  const order = found.review.docs().map((one) => one.id);
  const places = found.review
    .comments()
    .map((one) => ({ ...one, index: order.indexOf(one.block), pos: one.range.from }));
  const next = nearest(places, caretPlace(found.review, found.editor), direction);
  if (!next) return say(t('textReview.noComments'));
  goToComment(found.review, next.block, next.range.id);
  focusComment(next.range.id, false);
}

/** The comment at the caret: the innermost one, or the one the pane has the focus in. */
function commentHere(found: NonNullable<ReturnType<typeof shown>>): { block: string; id: string } | null {
  const { editor, review } = found;
  const block = editor ? review.blockOf(editor) : null;
  if (!editor || !block) return null;
  const id = commentsAt(editor.state.doc, editor.state.selection.from)[0];
  return id ? { block, id } : null;
}

export function resolveHere(resolved: boolean): void {
  const found = shown();
  const here = found ? commentHere(found) : null;
  if (!found || !here) return say(t('textReview.noCommentHere'));
  setResolved(found.review, here.block, here.id, resolved);
}

export function deleteHere(): void {
  const found = shown();
  const here = found ? commentHere(found) : null;
  if (!found || !here) return say(t('textReview.noCommentHere'));
  deleteComment(found.review, here.block, here.id);
}

export function toggleSuggesting(): void {
  suggesting.set(!suggesting.get());
  say(t(suggesting.get() ? 'textReview.suggestingOn' : 'textReview.suggestingOff'));
}

export function setMarkup(markup: Markup): void {
  setReviewPrefs({ markup });
  const name = {
    simple: 'textReview.markupSimple',
    all: 'textReview.markupAll',
    none: 'textReview.markupNone',
  } as const;
  say(t('textReview.markupNow', { markup: t(name[markup]) }));
}

const authorOf = (id: string) => findSuggestion(id)?.author ?? null;
const beforeOf = (id: string) => findSuggestion(id)?.before;

/** Accepts or rejects the changes `which` picks in one block's editor. Returns how many it settled. */
function decideIn(editor: Editor, decision: Decision, which: Which): number {
  const changes = pick(editor.state.doc, { authorOf, ...which });
  const tr = decide(editor.state, changes, decision, beforeOf);
  if (!tr) return 0;
  editor.view.dispatch(tr);
  return changes.length;
}

function announceCount(decision: Decision, count: number): void {
  if (count === 0) return say(t('textReview.noChanges'));
  say(t(decision === 'accept' ? 'textReview.accepted' : 'textReview.rejected', { count }));
}

/** Accept or Reject at the caret: the changes the selection touches, then the caret goes to the next change. */
export function decideHere(decision: Decision): void {
  const found = shown();
  if (!found?.editor) return say(t('textReview.needsText'));
  const { from, to } = found.editor.state.selection;
  const count = decideIn(found.editor, decision, { near: { from, to } });
  if (count === 0) return say(t('textReview.noChangeHere'));
  announceCount(decision, count);
  moveToChange(1, false);
}

/** Accept all or Reject all on the page, or only one author's changes. Each block's change is its own undo step. */
export function decideAll(decision: Decision, author?: string): void {
  const found = shown();
  if (!found) return say(t('textReview.needsText'));
  const blocks = [...new Set(found.review.changes().map((one) => one.block))];
  let count = 0;
  for (const block of blocks) {
    const editor = editorFor(found.review, block);
    if (editor) count += decideIn(editor, decision, author === undefined ? {} : { author });
  }
  announceCount(decision, count);
}

/** Accept or Reject all changes by one author, chosen from a menu of the page's authors. */
export async function decideByAuthor(decision: Decision): Promise<void> {
  const found = shown();
  if (!found) return say(t('textReview.needsText'));
  const authors = [...new Set(found.review.changes().map((one) => one.author ?? ''))].filter(Boolean).sort();
  if (authors.length === 0) return say(t('textReview.noChanges'));
  const chosen = await openMenu({
    label: t(decision === 'accept' ? 'textReview.acceptByAuthor' : 'textReview.rejectByAuthor'),
    items: authors.map((author, index) => ({ id: String(index), label: author })),
    anchor: document.activeElement instanceof HTMLElement ? document.activeElement : document.body,
  });
  if (chosen !== null) decideAll(decision, authors[Number(chosen)]);
}

/** Next change or Previous change: in this block first, then the next block with changes, around the page. */
export function moveToChange(direction: 1 | -1, announceNone = true): void {
  const found = shown();
  if (!found) return say(t('textReview.needsText'));
  const { editor, review } = found;
  const inBlock = editor ? nextChange(editor.state, direction) : null;
  if (editor && inBlock) {
    editor.view.dispatch(selectRange(editor.state, inBlock.from, inBlock.to).setMeta(META_COMMAND, true));
    return;
  }
  const docs = review.docs();
  const here = caretPlace(review, editor).index;
  const count = docs.length;
  for (let step = 1; step <= count; step++) {
    const index = (((here + direction * step) % count) + count) % count;
    const changes = review.changes().filter((one) => one.block === docs[index].id);
    const target = direction === 1 ? changes[0] : changes[changes.length - 1];
    if (!target) continue;
    const other = editorFor(review, target.block);
    if (!other) continue;
    other.view.dispatch(selectRange(other.state, target.change.from, target.change.to));
    other.view.focus();
    return;
  }
  if (announceNone) say(t('textReview.noChanges'));
}
