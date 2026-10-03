// @vitest-environment jsdom
// The text sync with fake timers over the memory page service: when typing goes, what flushes it, the splices it
// sends, automatic changes as their own step, followers, composition, and new text boxes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { META_AUTO_CHANGE, META_COMMAND } from '../../../editor/meta';
import { PageServiceError } from '../../../services/pages/types';
import { exitHook } from './queue';
import { blockId, caretAtEnd, syncPage, syncRig } from './testSync';
import type { SyncRig } from './testSync';

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

describe('a change the core refuses', () => {
  const refuseOnce = (rig: SyncRig) => {
    const send = rig.page.send.bind(rig.page);
    let refused = false;
    return vi.spyOn(rig.page, 'send').mockImplementation((batch) => {
      if (refused) return send(batch);
      refused = true;
      return Promise.reject(new PageServiceError('locked', 'Locked for now.'));
    });
  };

  it('keeps the text unsent, and sends it again with the next flush', async () => {
    const rig = await syncRig(syncPage(['Hello']));
    caretAtEnd(rig.editors.get(A)!);
    refuseOnce(rig);
    rig.type(A, '!');
    await tick(150);
    expect(rig.syncs.get(A)!.dirty).toBe(true);
    expect(rig.queue.hasUnsent()).toBe(true);
    await rig.queue.flushAll('exit');
    expect((await rig.held()).blocks[0].data.markdown).toBe('Hello!');
    expect(rig.queue.hasUnsent()).toBe(false);
  });

  it('inserts a new text box again after its first insert was refused', async () => {
    const rig = await syncRig(syncPage(['One']));
    const C = blockId(3);
    rig.mount(C, '', { block: { id: C, type: 'text', frame: { x: 40, y: 80, w: 300 } } });
    refuseOnce(rig);
    rig.type(C, 'Notes');
    await tick(150);
    rig.type(C, '!');
    await tick(150);
    const held = await rig.held();
    expect(held.blocks.find((block) => block.id === C)?.data.markdown).toBe('Notes!');
  });

  it('keeps edits that rode along with a refused batch for the next one', async () => {
    const rig = await syncRig(syncPage(['One', 'Two']));
    caretAtEnd(rig.editors.get(A)!);
    refuseOnce(rig);
    rig.type(A, 'x');
    rig.queue.appendToNextBatch(A, [{ edit: 'deleteBlocks', blocks: [B] }]);
    await tick(150);
    await rig.queue.flushAll('exit');
    const held = await rig.held();
    expect(held.blocks.map((block) => [block.id, block.data.markdown])).toEqual([[A, 'Onex']]);
  });

  it('keeps the window open on exit while a refused change is unsent, until Close anyway', async () => {
    const rig = await syncRig(syncPage(['Hello']));
    caretAtEnd(rig.editors.get(A)!);
    vi.spyOn(rig.page, 'send').mockRejectedValue(new PageServiceError('locked', 'Locked for now.'));
    rig.type(A, '!');
    const exit = exitHook(rig.queue);
    const refused = await exit();
    expect(refused).toMatchObject({ ok: false, reason: 'pageSync.exitUnsaved' });
    if (refused.ok) return;
    refused.closeAnyway?.();
    expect(await exit()).toEqual({ ok: true });
  });
});
