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
import { MAX_RECORD_BYTES, MAX_REPLIES } from './records';
import type { CommentJson } from './records';
import { setReviewPrefs } from './state';
import { toastStore } from '../../state/toasts';

vi.mock('../../ui/toast', () => ({ showToast: vi.fn() }));

const C1 = '01m3sbcmt0000000000000c001';
const AT = '2026-11-07T09:00:00.000Z';
const NAME = 'Avery Quinn';

/** A page view with one text block whose editor is real, and a sync that records what it sends. */
function fakePage(
  test: TestEditor,
  options: { stored?: Record<string, unknown>; live?: boolean; reject?: boolean } = {},
) {
  test.root.dataset.block = 'b1';
  const block = (): BlockJson => ({
    id: 'b1',
    type: 'text',
    order: 'a0',
    created: AT,
    modified: AT,
    data: { markdown: markdownOf(test.editor.state), ...options.stored },
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
        return options.reject ? Promise.reject(new Error('read-only')) : Promise.resolve();
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
    liveDoc: () => (options.live === false ? null : test.editor.state.doc),
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

describe('the comments pane limits (spec 16)', () => {
  it('refuses a comment over 64 KiB of UTF-8 and a reply past 256 replies (spec 16)', async () => {
    expect(MAX_RECORD_BYTES).toBe(65536);
    expect(MAX_REPLIES).toBe(256);
    test = mountEditor('One <span data-comment="' + C1 + '">two</span> three');
    const record: CommentJson = { author: NAME, time: AT, markdown: '', replies: [], resolved: false };
    const page = fakePage(test, { stored: { comments: { [C1]: record } } });
    review = page.review;
    act(() => openPane(page.review));
    const item = await screen.findByRole('listitem');
    const box = within(item).getByRole('textbox', { name: 'Comment text' });
    const post = () => within(item).getByRole('button', { name: 'Post' });
    // 65,536 one-byte characters fit exactly.
    fireEvent.change(box, { target: { value: 'a'.repeat(65536) } });
    expect(post().hasAttribute('disabled')).toBe(false);
    expect(within(item).queryByText(/Too long/)).toBeNull();
    // 32,769 two-byte characters are 65,538 bytes: one character more than fits.
    fireEvent.change(box, { target: { value: 'é'.repeat(32769) } });
    expect(post().hasAttribute('disabled')).toBe(true);
    expect(within(item).getByText(/Too long/)).toBeTruthy();
    act(() => fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true }));
    expect(page.sent).toEqual([]);

    const reply = { author: NAME, time: AT, markdown: 'Yes.' };
    act(() =>
      page.review.model.setBlock('b1', {
        comments: { [C1]: { ...record, markdown: 'Why?', replies: Array(255).fill(reply) } },
      }),
    );
    expect(within(item).getByRole('textbox', { name: 'Reply' })).toBeTruthy();
    act(() =>
      page.review.model.setBlock('b1', {
        comments: { [C1]: { ...record, markdown: 'Why?', replies: Array(256).fill(reply) } },
      }),
    );
    expect(within(item).queryByRole('textbox', { name: 'Reply' })).toBeNull();
    expect(within(item).getByText('No more replies fit.')).toBeTruthy();
  });
});

describe('the comments pane records', () => {
  it('puts back what the core holds when it refuses a record-only change', async () => {
    test = mountEditor('One <span data-comment="' + C1 + '">two</span> three');
    const record: CommentJson = { author: NAME, time: AT, markdown: 'Why?', replies: [], resolved: false };
    const page = fakePage(test, { stored: { comments: { [C1]: record } }, reject: true });
    review = page.review;
    page.review.send('b1', { comments: { [C1]: { resolved: true } } });
    expect(page.review.model.comment(C1)?.record.resolved).toBe(true);
    await vi.waitFor(() => expect(page.review.model.comment(C1)?.record.resolved).toBe(false));
    const { current, queue } = toastStore.get();
    expect([current, ...queue].map((toast) => toast?.message)).toContain('Comment not saved.');
  });

  it('parses a block without an editor once per Markdown, and a caret move does not list the comments again', async () => {
    test = mountEditor('One <span data-comment="' + C1 + '">two</span> three');
    const page = fakePage(test, { live: false });
    review = page.review;
    const [first] = page.review.docs();
    expect(page.review.docs()[0].doc).toBe(first.doc);
    const comments = vi.spyOn(page.review, 'comments');
    act(() => openPane(page.review));
    await screen.findByRole('listitem');
    const before = comments.mock.calls.length;
    act(() => void document.dispatchEvent(new Event('selectionchange')));
    expect(comments.mock.calls.length).toBe(before);
  });
});
