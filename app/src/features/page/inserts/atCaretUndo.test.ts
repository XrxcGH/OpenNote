// @vitest-environment jsdom
// Each insert from a kit (an answer, an equation, or steps) is an undo step of its own. Ctrl+Z takes back the last
// one. The typing and the earlier inserts stay.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../../../editor/commands/testing';
import { blockId, caretAtEnd, syncPage, syncRig } from '../sync/testSync';
import { insertMathAtCaret, insertTextAtCaret } from './atCaret';

vi.mock('../../../ui/toast', () => ({ showToast: vi.fn() }));

const A = blockId(1);
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

it('undoes the inserts one at a time and leaves the typing for last', async () => {
  const rig = await syncRig(syncPage(['Work']));
  rig.focused.block = A;
  const editor = rig.editors.get(A)!;
  caretAtEnd(editor);
  rig.type(A, ' here');
  insertMathAtCaret(editor, 'x=2', true);
  insertTextAtCaret(editor, 'x = 2');
  await tick(500);
  const markdownOf = async () => String((await rig.held()).blocks.find((block) => block.id === A)!.data.markdown);
  const full = await markdownOf();
  expect(full).toContain('x=2');
  expect(full).toContain('x = 2');

  await rig.queue.undo();
  await tick(500);
  const first = await markdownOf();
  expect(first).toContain('x=2');
  expect(first).not.toContain('x = 2');

  await rig.queue.undo();
  await tick(500);
  const second = await markdownOf();
  expect(second).not.toContain('x=2');
  expect(second).toContain('Work here');
});
