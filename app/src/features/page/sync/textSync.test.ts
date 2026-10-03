// @vitest-environment jsdom
// The text sync with fake timers over the memory page service: when typing goes, what flushes it, the splices it
// sends, automatic changes as their own step, followers, composition, and new text boxes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { META_AUTO_CHANGE, META_COMMAND } from '../../../editor/meta';
import { blockId, caretAtEnd, syncPage, syncRig } from './testSync';

vi.mock('../../../ui/toast', () => ({ showToast: vi.fn() }));

const A = blockId(1);
const B = blockId(2);
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('when typing goes', () => {
  it('sends typing 150 ms after its last change, as one typing splice', async () => {
    const rig = await syncRig(syncPage(['Hello']));
    caretAtEnd(rig.editors.get(A)!);
    rig.type(A, 'ab');
    await tick(100);
    rig.type(A, 'c');
    await tick(149);
    expect(rig.sent()).toHaveLength(0);
    await tick(1);
    expect(rig.sent()).toEqual([
      {
        edits: [{ edit: 'spliceText', block: A, at: 5, del: '', ins: 'abc' }],
        coalesce: { kind: 'typing', target: A },
        ui: {
          before: { kind: 'text', block: A, anchor: 6, head: 6 },
          after: { kind: 'text', block: A, anchor: 9, head: 9 },
        },
      },
    ]);
  });

  it('sends typing that continues at least every 300 ms', async () => {
    const rig = await syncRig(syncPage(['']));
    for (let i = 0; i < 6; i++) {
      rig.type(A, 'x');
      await tick(100);
    }
    expect(rig.sent().map((batch) => batch.edits[0])).toEqual([
      { edit: 'spliceText', block: A, at: 0, del: '', ins: 'xxx' },
      { edit: 'spliceText', block: A, at: 3, del: '', ins: 'xxx' },
    ]);
  });

  it('sends nothing for a change that leaves the Markdown as it was', async () => {
    const rig = await syncRig(syncPage(['Hello']));
    caretAtEnd(rig.editors.get(A)!);
    rig.type(A, 'x');
    const editor = rig.editors.get(A)!;
    editor.view.dispatch(editor.state.tr.delete(6, 7));
    await tick(300);
    expect(rig.sent()).toHaveLength(0);
  });
});

describe('what flushes typing at once', () => {
  it('sends typing first, then a command as its own step', async () => {
    const rig = await syncRig(syncPage(['Hello']));
    const editor = rig.editors.get(A)!;
    caretAtEnd(editor);
    rig.type(A, '!');
    editor.view.dispatch(editor.state.tr.insertText('?').setMeta(META_COMMAND, true));
    await tick(0);
    expect(rig.sent().map((batch) => [batch.edits[0], batch.coalesce])).toEqual([
      [
        { edit: 'spliceText', block: A, at: 5, del: '', ins: '!' },
        { kind: 'typing', target: A },
      ],
      [{ edit: 'spliceText', block: A, at: 6, del: '', ins: '?' }, undefined],
    ]);
  });

  it('sends what was typed first when the caret jumps', async () => {
    const rig = await syncRig(syncPage(['Hello']));
    const editor = rig.editors.get(A)!;
    caretAtEnd(editor);
    rig.type(A, '!');
    editor.commands.setTextSelection(1);
    rig.type(A, 'X');
    await tick(0);
    expect(rig.sent().map((batch) => batch.edits[0])).toEqual([
      { edit: 'spliceText', block: A, at: 5, del: '', ins: '!' },
    ]);
    await tick(150);
    expect(rig.sent()[1].edits[0]).toEqual({ edit: 'spliceText', block: A, at: 0, del: '', ins: 'X' });
  });

  it('flushes on blur, on flushAll, and before an object edit, in the order of the changes', async () => {
    const rig = await syncRig(syncPage(['One', 'Two']));
    caretAtEnd(rig.editors.get(A)!);
    rig.type(A, 'a');
    rig.editors.get(A)!.view.dom.dispatchEvent(new FocusEvent('blur'));
    await tick(0);
    expect(rig.sent()).toHaveLength(1);
    caretAtEnd(rig.editors.get(B)!);
    rig.type(B, 'b');
    const move = rig.queue.send({ edits: [{ edit: 'moveBlock', block: A, after: B }] });
    await tick(0);
    await move;
    expect(rig.sent().map((batch) => batch.edits[0].edit)).toEqual(['spliceText', 'spliceText', 'moveBlock']);
    rig.type(B, 'c');
    await rig.queue.flushAll('exit');
    expect((await rig.held()).blocks.map((block) => block.data.markdown)).toEqual(['Twobc', 'Onea']);
  });
});

describe('the edits a flush sends', () => {
  it('counts splice offsets in UTF-8 bytes across emoji and CJK', async () => {
    const rig = await syncRig(syncPage(['日本 😀 end']));
    caretAtEnd(rig.editors.get(A)!);
    rig.type(A, '!');
    await tick(150);
    expect(rig.sent()[0].edits).toEqual([{ edit: 'spliceText', block: A, at: 15, del: '', ins: '!' }]);
    expect((await rig.held()).blocks[0].data.markdown).toBe('日本 😀 end!');
  });

  it('sends the whole text when the core takes no splices', async () => {
    const rig = await syncRig(syncPage(['Hello']), { supportsSplice: false });
    caretAtEnd(rig.editors.get(A)!);
    rig.type(A, '!');
    await tick(150);
    expect(rig.sent()[0].edits).toEqual([{ edit: 'setText', block: A, markdown: 'Hello!' }]);
  });

  it('sends the text as typed, then an automatic change as a step of its own', async () => {
    const rig = await syncRig(syncPage(['']));
    const editor = rig.editors.get(A)!;
    // As the editor does it: the comma is typed first, and the correction follows in its own transaction.
    rig.type(A, 'teh,');
    const { tr } = editor.state;
    tr.insertText('the', 1, 4).setMeta(META_AUTO_CHANGE, { from: 1, to: 4, text: 'the' });
    editor.view.dispatch(tr);
    await tick(0);
    expect(rig.sent().map((batch) => batch.coalesce?.kind ?? null)).toEqual(['typing', null]);
    expect((await rig.held()).blocks[0].data.markdown).toBe('the,');
    await rig.page.undo();
    expect((await rig.held()).blocks[0].data.markdown).toBe('teh,');
  });

  it('lets follower moves ride in the typing batch, and sends lone ones on their own', async () => {
    const rig = await syncRig(syncPage(['One', 'Two']));
    caretAtEnd(rig.editors.get(A)!);
    rig.type(A, 'x');
    rig.queue.addFollowerMoves(A, [{ edit: 'moveBlock', block: B, frame: { y: 40 } }]);
    rig.queue.addFollowerMoves(A, [{ edit: 'moveBlock', block: B, frame: { y: 60 } }]);
    await tick(150);
    expect(rig.sent()[0].edits).toEqual([
      { edit: 'spliceText', block: A, at: 3, del: '', ins: 'x' },
      { edit: 'moveBlock', block: B, frame: { y: 60 } },
    ]);
    rig.queue.appendToNextBatch(B, [{ edit: 'moveBlock', block: A, frame: { y: 10 } }]);
    await tick(150);
    expect(rig.sent()[1]).toEqual({ edits: [{ edit: 'moveBlock', block: A, frame: { y: 10 } }] });
  });
});

describe('a new text box', () => {
  it('takes the order key the core chose, so a block inserted after it shows below it', async () => {
    const rig = await syncRig(syncPage(['Oct 3, 2026']));
    const draft = blockId(9);
    rig.mount(draft, '', { block: { id: draft, type: 'text' } });
    rig.type(draft, 'Typed');
    await tick(150);
    const held = (await rig.held()).blocks.find((block) => block.id === draft);
    expect(held?.data.markdown).toBe('Typed');
    expect(rig.orders[draft]).toBe(held?.order);
    expect(rig.orders[draft] > 'a0').toBe(true);
  });
});
