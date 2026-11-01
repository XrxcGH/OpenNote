// @vitest-environment jsdom
// Typing while an undo is still in flight, as the nightly soak does right after a burst of Ctrl+Z. A text above
// 64 KB parses in the worker, and the person types during that wait. The frame lands on the text shown after the
// wait, never at positions from the text before it, so the editor ends showing what the core holds.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseInWorker, parseTextBlock } from '../../../editor/markdown';
import { blockId, caretAtEnd, syncPage, syncRig } from './testSync';

vi.mock('../../../ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../../editor/markdown', async (original) => {
  const actual = await original<typeof import('../../../editor/markdown')>();
  // Every frame takes the full parse, which goes to the worker above 64 KB.
  return { ...actual, parseInWorker: vi.fn(), reparseRange: () => 'full' as const };
});

const A = blockId(1);
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const LONG = 'word '.repeat(14_000).trim();

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

it('applies an undo frame to the text typed while the worker parsed it', async () => {
  let release: (() => void) | null = null;
  vi.mocked(parseInWorker).mockImplementation((markdown) => Promise.resolve(parseTextBlock(markdown)));
  vi.mocked(parseInWorker).mockImplementationOnce(
    (markdown) => new Promise<PMNode>((resolve) => (release = () => resolve(parseTextBlock(markdown)))),
  );
  const rig = await syncRig(syncPage([`Intro\n\n${LONG}\n\nLast`]));
  rig.focused.block = A;
  const editor = rig.editors.get(A)!;
  caretAtEnd(editor);
  rig.type(A, ' more');
  await tick(150);

  const undo = rig.queue.undo();
  for (let i = 0; i < 20 && !release; i++) await tick(0);
  expect(release).not.toBeNull();
  editor.commands.setTextSelection(1);
  rig.type(A, 'zz');
  release!();
  await expect(undo).resolves.toBeUndefined();
  await tick(500);

  const held = await rig.held();
  const markdown = String(held.blocks.find((block) => block.id === A)!.data.markdown);
  expect(editor.state.doc.toJSON()).toEqual(parseTextBlock(markdown).toJSON());
  expect(editor.state.doc.lastChild?.textContent).toBe('Last');
});
