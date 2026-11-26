// @vitest-environment jsdom
// Ctrl+Z pressed several times in a row, as in the nightly soak's crash ("Cannot join bulletList onto paragraph").
// Each undo applies its frame to the text the previous undo left. A burst ends where the same undos one by one end.
// No frame lands at positions from an older text.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blockId, caretAtEnd, syncPage, syncRig } from './testSync';
import type { SyncRig } from './testSync';

vi.mock('../../../ui/toast', () => ({ showToast: vi.fn() }));

const A = blockId(1);
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** A list after a paragraph, then three flushed edits: the list grows, the paragraph grows, the list grows. */
async function edited(): Promise<SyncRig> {
  const rig = await syncRig(syncPage(['Intro\n\n- one\n- two']));
  rig.focused.block = A;
  const editor = rig.editors.get(A)!;
  caretAtEnd(editor);
  rig.type(A, ' more');
  await tick(150);
  editor.commands.setTextSelection(6);
  rig.type(A, ' and a longer opening line');
  await tick(150);
  caretAtEnd(editor);
  rig.type(A, ' again');
  await tick(150);
  return rig;
}

it('applies a burst of undos one after another, like the same undos one by one', async () => {
  const oneByOne = await edited();
  for (let i = 0; i < 3; i++) await oneByOne.queue.undo();
  const expected = oneByOne.editors.get(A)!.state.doc.toJSON();
  expect(oneByOne.editors.get(A)!.state.doc.textContent).toBe('Introonetwo');
  document.body.replaceChildren();

  const burst = await edited();
  const errors: unknown[] = [];
  await Promise.all([0, 1, 2].map(() => burst.queue.undo().catch((error: unknown) => void errors.push(error))));
  expect(errors).toEqual([]);
  expect(burst.editors.get(A)!.state.doc.toJSON()).toEqual(expected);

  await Promise.all([0, 1, 2].map(() => burst.queue.redo()));
  expect(burst.editors.get(A)!.state.doc.textContent).toBe('Intro and a longer opening lineonetwo more again');
});
