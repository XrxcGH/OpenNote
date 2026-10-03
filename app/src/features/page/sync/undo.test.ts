// @vitest-environment jsdom
// Frames, undo, and redo over the memory page service: minimal replacements, the flush before the round trip,
// selections, announcements, failures, other windows' frames, composition, and new text boxes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarkdownCache, parseTextBlock } from '../../../editor/markdown';
import type { AppliedFrame, BlockJson } from '../../../services/pages/types';
import { showToast } from '../../../ui/toast';
import { applyFrame, minimalReplacement } from './frames';
import { blockId, caretAtEnd, syncPage, syncRig } from './testSync';

vi.mock('../../../ui/toast', () => ({ showToast: vi.fn() }));

const A = blockId(1);
const B = blockId(2);
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const AT = '2026-10-01T09:00:00.000Z';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.mocked(showToast).mockClear();
  document.body.replaceChildren();
});

describe('applying frames', () => {
  it('replaces only the top-level nodes that changed', () => {
    const before = parseTextBlock('One\n\nTwo\n\nThree');
    const after = parseTextBlock('One\n\nTwo, changed\n\nThree');
    const change = minimalReplacement(before, after)!;
    expect([change.from, change.to]).toEqual([5, 10]);
    expect(change.content.firstChild?.textContent).toBe('Two, changed');
    expect(minimalReplacement(before, parseTextBlock('One\n\nTwo\n\nThree'))).toBeNull();
    expect(minimalReplacement(parseTextBlock('a **b**'), parseTextBlock('a b'))).not.toBeNull();
    expect(minimalReplacement(parseTextBlock('# a'), parseTextBlock('## a'))).not.toBeNull();
  });

  it('keeps unchanged paragraphs in the editor, updates other blocks, and restores the selection', async () => {
    const rig = await syncRig(syncPage(['One\n\nTwo\n\nThree']));
    const editor = rig.editors.get(A)!;
    const kept = editor.state.doc.child(0);
    const image: BlockJson = { id: B, type: 'image', order: 'b', created: AT, modified: AT, data: { asset: 'x' } };
    const frame: AppliedFrame = {
      blocks: [{ ...rig.page.initial.blocks[0], data: { markdown: 'One\n\nTwo!\n\nThree' } }, image],
      removed: ['gone'],
      page: { title: 'Renamed' },
      assets: {},
      ui: { before: { kind: 'objects', blocks: [B] }, after: { kind: 'text', block: A, anchor: 1, head: 1 } },
      canUndo: true,
      canRedo: false,
    };
    const result = await applyFrame(frame, frameOf(rig), createMarkdownCache(), 'undo');
    expect(editor.state.doc.child(0)).toBe(kept);
    expect(editor.state.doc.child(1).textContent).toBe('Two!');
    expect(rig.syncs.get(A)!.lastSent()).toBe('One\n\nTwo!\n\nThree');
    expect(rig.calls).toEqual([
      `text ${A}`,
      `upsert ${A}`,
      `upsert ${B}`,
      'remove gone',
      'fields {"title":"Renamed"}',
      `select {"kind":"objects","blocks":["${B}"]}`,
    ]);
    expect(result).toEqual({ outsideFocus: true, changed: [A, B, 'gone'] });
  });
});

/** The rig's frame context, which the queue was made with. */
function frameOf(rig: Awaited<ReturnType<typeof syncRig>>) {
  return (rig.queue as unknown as { host: { frames: Parameters<typeof applyFrame>[1] } }).host.frames;
}

describe('undo and redo', () => {
  it('flushes typing first, then undoes and redoes it as one step, with its selection', async () => {
    const rig = await syncRig(syncPage(['Hello']));
    rig.focused.block = A;
    caretAtEnd(rig.editors.get(A)!);
    rig.type(A, ' world');
    await rig.queue.undo();
    expect(rig.editors.get(A)!.state.doc.textContent).toBe('Hello');
    expect(rig.calls.at(-1)).toBe(`select ${JSON.stringify({ kind: 'text', block: A, anchor: 6, head: 6 })}`);
    expect([rig.queue.canUndo(), rig.queue.canRedo()]).toEqual([false, true]);
    await rig.queue.redo();
    expect(rig.editors.get(A)!.state.doc.textContent).toBe('Hello world');
    expect(rig.announced).toEqual([]);
    rig.type(A, '!');
    await tick(150);
    expect((await rig.held()).blocks[0].data.markdown).toBe('Hello world!');
  });

  it('says what an undo changed outside the focused text box, and when there is nothing to undo', async () => {
    const rig = await syncRig(syncPage(['One', 'Two']));
    rig.focused.block = A;
    await rig.queue.send({ edits: [{ edit: 'moveBlock', block: B, frame: { x: 10, y: 20 } }] });
    await rig.queue.undo();
    await rig.queue.redo();
    await rig.queue.send({ edits: [{ edit: 'deleteBlocks', blocks: [B] }] });
    await rig.queue.undo();
    await rig.queue.undo();
    await rig.queue.undo();
    expect(rig.announced).toEqual([
      'Undid moving a text box.',
      'Redid moving a text box.',
      'Undid deleting a text box.',
      'Undid moving a text box.',
      'Nothing to undo.',
    ]);
    expect(rig.calls).toContain(`upsert ${B}`);
  });

  it('shows why an undo failed when another window changed the text since', async () => {
    const rig = await syncRig(syncPage(['Hello']));
    caretAtEnd(rig.editors.get(A)!);
    rig.type(A, '!');
    await rig.queue.flushAll('command');
    const other = await rig.service.open(rig.page.id, { viewport: null });
    await other.send({ edits: [{ edit: 'setText', block: A, markdown: 'Theirs' }] });
    await rig.queue.undo();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'This change can’t be undone, because it was changed in another window.' }),
    );
  });

  it('applies another window’s change without moving the selection', async () => {
    const rig = await syncRig(syncPage(['Hello']));
    const other = await rig.service.open(rig.page.id, { viewport: null });
    await other.send({ edits: [{ edit: 'setText', block: A, markdown: 'Hello from there' }] });
    await tick(0);
    expect(rig.editors.get(A)!.state.doc.textContent).toBe('Hello from there');
    expect(rig.calls.some((call) => call.startsWith('select'))).toBe(false);
  });
});

describe('composition and new text boxes', () => {
  it('sends nothing while an input method composes, then one batch after it ends', async () => {
    const rig = await syncRig(syncPage(['']));
    const editor = rig.editors.get(A)!;
    let composing = true;
    Object.defineProperty(editor.view, 'composing', { get: () => composing, configurable: true });
    rig.type(A, 'にほん');
    await tick(1000);
    await rig.queue.flushAll('command');
    expect(rig.sent()).toHaveLength(0);
    composing = false;
    editor.view.dom.dispatchEvent(new Event('compositionend'));
    await tick(150);
    expect(rig.sent().map((batch) => batch.edits)).toEqual([
      [{ edit: 'spliceText', block: A, at: 0, del: '', ins: 'にほん' }],
    ]);
  });

  it('inserts a new text box with its first flush, and coalesces typing after it', async () => {
    const rig = await syncRig(syncPage([]));
    const C = blockId(3);
    rig.mount(C, '', { block: { id: C, type: 'text', frame: { x: 40, y: 80, w: 300 } } });
    rig.type(C, 'Hi');
    await tick(150);
    rig.type(C, '!');
    await tick(150);
    expect(rig.sent().map((batch) => [batch.edits[0].edit, batch.coalesce?.kind ?? null])).toEqual([
      ['insertBlock', null],
      ['spliceText', 'typing'],
    ]);
    expect(rig.sent()[0].edits[0]).toMatchObject({
      block: { id: C, frame: { x: 40, y: 80, w: 300 }, data: { markdown: 'Hi' } },
    });
  });

  it('drops a floating text box left empty when focus leaves it', async () => {
    const rig = await syncRig(syncPage([]));
    const [C, D] = [blockId(3), blockId(4)];
    rig.mount(C, '', { block: { id: C, type: 'text', frame: { x: 40, y: 80 } } });
    rig.editors.get(C)!.view.dom.dispatchEvent(new FocusEvent('blur'));
    rig.mount(D, '', { block: { id: D, type: 'text', frame: { x: 40, y: 200 } } });
    rig.type(D, 'x');
    await tick(150);
    const editor = rig.editors.get(D)!;
    editor.view.dispatch(editor.state.tr.delete(1, 2));
    editor.view.dom.dispatchEvent(new FocusEvent('blur'));
    await tick(0);
    expect(rig.calls).toEqual([`remove ${C}`, `remove ${D}`]);
    expect(rig.sent().at(-1)).toEqual({ edits: [{ edit: 'deleteBlocks', blocks: [D] }] });
  });
});
