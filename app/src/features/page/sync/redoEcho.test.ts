// @vitest-environment jsdom
// Text the core holds (from the page or from an undo or redo frame) may be written back by the editor a little
// differently: a trailing space, an empty paragraph. Sending that as an edit when a plugin's own transaction comes
// along would clear the core's redo stack, so it is not sent (full walk A2-A12-8, A-A05-1, A-A06-7).
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMarkdownCache } from '../../../editor/markdown';
import type { AppliedFrame } from '../../../services/pages/types';
import { applyFrame } from './frames';
import { blockId, caretAtEnd, syncPage, syncRig } from './testSync';

vi.mock('../../../ui/toast', () => ({ showToast: vi.fn() }));

const A = blockId(1);

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** A plugin's own transaction, which changes the document but not its Markdown. */
function pluginChange(rig: Awaited<ReturnType<typeof syncRig>>): void {
  const editor = rig.editors.get(A)!;
  editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'id', `p${Math.random()}`));
}

it('sends nothing for the page’s own text written back differently', async () => {
  const rig = await syncRig(syncPage(['alpha ']));
  pluginChange(rig);
  await vi.advanceTimersByTimeAsync(2000);
  expect(rig.sent()).toHaveLength(0);
});

it('sends nothing for a frame’s text written back differently, and still sends a real change', async () => {
  const rig = await syncRig(syncPage(['alpha']));
  const frames = (rig.queue as unknown as { host: { frames: Parameters<typeof applyFrame>[1] } }).host.frames;
  const frame: AppliedFrame = {
    blocks: [{ ...rig.page.initial.blocks[0], data: { markdown: 'alpha\n\n---\n\n' } }],
    removed: [],
    page: null,
    ui: null,
    assets: {},
    canUndo: true,
    canRedo: true,
  };
  await applyFrame(frame, frames, createMarkdownCache(), 'redo');
  pluginChange(rig);
  await vi.advanceTimersByTimeAsync(2000);
  expect(rig.sent()).toHaveLength(0);
  const editor = rig.editors.get(A)!;
  editor.commands.setTextSelection(3);
  rig.type(A, 'X');
  await vi.advanceTimersByTimeAsync(400);
  expect(rig.sent()).toHaveLength(1);
});

it('keeps redo after an undo when the editor normalizes the text', async () => {
  const rig = await syncRig(syncPage(['alpha']));
  rig.focused.block = A;
  caretAtEnd(rig.editors.get(A)!);
  rig.type(A, ' beta');
  await vi.advanceTimersByTimeAsync(400);
  await rig.queue.undo();
  pluginChange(rig);
  await vi.advanceTimersByTimeAsync(2000);
  expect(rig.queue.canRedo()).toBe(true);
});
