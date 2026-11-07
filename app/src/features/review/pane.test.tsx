// @vitest-environment jsdom
// The comments pane on a page view (ADR 0086). A new comment's record rides with its mark. The pane posts the
// comment's text, replies, resolves, reopens, deletes, and goes to the text. Each record-only change is one
// patchBlock batch (spec 6.10, R-CMT-1).
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownOf, mountEditor } from '../../editor/commands/testing';
import type { TestEditor } from '../../editor/commands/testing';
import type { MountedPage } from '../page';
import type { BlockJson, EditBatch } from '../../services/pages/types';
import { goToComment, nearest } from './actions';
import { addComment, commentTarget } from './comments';
import { stageComment } from './model';
import { attachReview } from './page';
import type { PageReview, TextSeams } from './page';
import { closePane, openPane } from './pane';
import { setReviewPrefs } from './state';

vi.mock('../../ui/toast', () => ({ showToast: vi.fn() }));

const C1 = '01m3sbcmt0000000000000c001';
const AT = '2026-11-07T09:00:00.000Z';
const NAME = 'Avery Quinn';

/** A page view with one text block whose editor is real, and a sync that records what it sends. */
function fakePage(test: TestEditor) {
  test.root.dataset.block = 'b1';
  const block = (): BlockJson => ({
    id: 'b1',
    type: 'text',
    order: 'a0',
    created: AT,
    modified: AT,
    data: { markdown: markdownOf(test.editor.state) },
  });
  const frame = document.body.appendChild(document.createElement('div'));
  const viewport = frame.appendChild(document.createElement('div'));
  const sent: EditBatch[] = [];
  let rider: Parameters<TextSeams['addTextRider']>[0] | null = null;
  const mounted = {
    layer: {
      blocks: () => [block()],
      block: (id: string) => (id === 'b1' ? block() : null),
      view: () => null,
      onChange: () => () => undefined,
    },
    page: { onFrame: () => () => undefined },
    sync: {
      send: (batch: EditBatch) => {
        sent.push(batch);
        return Promise.resolve();
      },
      onStep: () => () => undefined,
    },
    pool: { editor: () => test.editor, mount: () => test.editor, onActiveChange: () => () => undefined },
    viewport: { viewport },
  } as unknown as MountedPage;
  const seams: TextSeams = {
    addTextRider(given) {
      rider = given;
      return () => (rider = null);
    },
    liveDoc: () => test.editor.state.doc,
  };
  const review = attachReview(mounted, seams);
  /** What the text sync does after a change: build the batch with the riders' edits. */
  const flush = (before: string) => rider?.('b1', before, markdownOf(test.editor.state)) ?? [];
  return { review, sent, flush };
}

let test: TestEditor | null = null;
let review: PageReview | null = null;
afterEach(() => {
  act(() => closePane());
  review?.detach();
  test?.destroy();
  test = null;
  review = null;
  cleanup();
  document.body.replaceChildren();
});

describe('the comments pane', () => {
  it('posts, replies, resolves, reopens, goes to, and deletes a comment', async () => {
    setReviewPrefs({ author: NAME });
    test = mountEditor('Plants [grow] fast');
    const page = fakePage(test);
    review = page.review;
    const before = markdownOf(test.editor.state);
    stageComment(C1, { author: NAME, time: AT, markdown: '', replies: [], resolved: false });
    test.editor.view.dispatch(addComment(test.editor.state, C1, commentTarget(test.editor.state)!)!);
    expect(page.flush(before)).toEqual([
      {
        edit: 'patchBlock',
        block: 'b1',
        data: { comments: { [C1]: { author: NAME, time: AT, markdown: '', replies: [], resolved: false } } },
      },
    ]);

    act(() => openPane(page.review));
    const item = await screen.findByRole('listitem');
    expect(within(item).getByText('On “grow”')).toBeTruthy();
    fireEvent.change(within(item).getByRole('textbox', { name: 'Comment text' }), {
      target: { value: 'Why so fast?' },
    });
    act(() => fireEvent.click(within(item).getByRole('button', { name: 'Post' })));
    expect(page.sent.at(-1)).toEqual({
      edits: [{ edit: 'patchBlock', block: 'b1', data: { comments: { [C1]: { markdown: 'Why so fast?' } } } }],
    });
    expect(within(item).getByText('Why so fast?')).toBeTruthy();

    fireEvent.change(within(item).getByRole('textbox', { name: 'Reply' }), { target: { value: 'Sunlight.' } });
    act(() => fireEvent.click(within(item).getByRole('button', { name: 'Reply' })));
    const replies = page.review.model.comment(C1)?.record.replies;
    expect(replies).toEqual([{ author: NAME, time: expect.any(String), markdown: 'Sunlight.' }]);
    expect(within(item).getByText('Sunlight.')).toBeTruthy();

    act(() => fireEvent.click(within(item).getByRole('button', { name: 'Resolve' })));
    expect(page.review.model.comment(C1)?.record.resolved).toBe(true);
    act(() => fireEvent.click(within(item).getByRole('button', { name: 'Reopen' })));
    expect(page.review.model.comment(C1)?.record.resolved).toBe(false);

    test.editor.commands.setTextSelection(1);
    act(() => fireEvent.click(within(item).getByRole('button', { name: 'Go to text' })));
    const { from, to } = test.editor.state.selection;
    expect(test.editor.state.doc.textBetween(from, to)).toBe('grow');

    const named = markdownOf(test.editor.state);
    act(() => fireEvent.click(within(item).getByRole('button', { name: 'Delete' })));
    expect(markdownOf(test.editor.state)).toBe('Plants grow fast');
    expect(page.flush(named)).toEqual([{ edit: 'patchBlock', block: 'b1', data: { comments: { [C1]: null } } }]);
  });

  it('goes to the next and previous comment around the page', () => {
    const comments = [
      { id: 'b', index: 0, pos: 30 },
      { id: 'a', index: 0, pos: 5 },
      { id: 'c', index: 1, pos: 2 },
    ];
    expect(nearest(comments, { index: 0, pos: 10 }, 1)?.id).toBe('b');
    expect(nearest(comments, { index: 0, pos: 30 }, 1)?.id).toBe('c');
    expect(nearest(comments, { index: 1, pos: 9 }, 1)?.id).toBe('a');
    expect(nearest(comments, { index: 0, pos: 5 }, -1)?.id).toBe('c');
    expect(nearest(comments, { index: 1, pos: 0 }, -1)?.id).toBe('b');
    expect(nearest([], { index: 0, pos: 0 }, 1)).toBeNull();
  });

  it('goes to a comment by selecting its text', () => {
    test = mountEditor('One [two] three');
    const page = fakePage(test);
    review = page.review;
    test.editor.view.dispatch(addComment(test.editor.state, C1, commentTarget(test.editor.state)!)!);
    test.editor.commands.setTextSelection(1);
    goToComment(page.review, 'b1', C1);
    const { from, to } = test.editor.state.selection;
    expect(test.editor.state.doc.textBetween(from, to)).toBe('two');
  });
});
