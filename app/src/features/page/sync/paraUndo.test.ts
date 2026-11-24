// @vitest-environment jsdom
// Paragraph formatting through the core (T2-C02-4). Ctrl+E is one undo step: the first Ctrl+Z takes the centering
// off and leaves the text, and Ctrl+Y puts the centering back. The editor shows each step the core takes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEditorCommand } from '../../../editor/commands/catalog';
import { editorExtensions } from '../../../editor/extensions/kit';
import { shownMounted } from '../pagesApi';
import type { MountedPage } from '../mount';
import { blockId, caretAtEnd, syncPage, syncRig } from './testSync';
import type { SyncRig } from './testSync';
// eslint-disable-next-line opennote/feature-boundaries -- The search barrel must not export the plugin.
import { elementExtensions } from '../../search/elements/plugin';

vi.mock('../../../ui/toast', () => ({ showToast: vi.fn() }));

editorExtensions.register({
  id: 'test.paraUndo.elements',
  order: 91,
  kinds: ['text'],
  create: (host) => elementExtensions(host, { tags: false, links: true }),
});

const A = blockId(1);
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  shownMounted.set(null);
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** A rig whose page is the shown page, with its text editor mounted again so the elements writer sees it. */
async function rigWithElements(): Promise<SyncRig> {
  const rig = await syncRig(syncPage(['']));
  rig.syncs.get(A)!.detach();
  rig.editors.get(A)!.destroy();
  shownMounted.set({
    page: rig.page,
    sync: rig.queue,
    layer: { block: () => ({ data: { markdown: '' } }) },
  } as unknown as MountedPage);
  rig.mount(A, '');
  await tick(0);
  return rig;
}

const align = (rig: SyncRig) => rig.editors.get(A)!.state.doc.firstChild!.attrs.align as string | null;
const held = async (rig: SyncRig) => (await rig.held()).blocks[0].data;

describe('paragraph formatting and undo', () => {
  it('makes Ctrl+E one undo step that the editor shows, and redoes it', async () => {
    const rig = await rigWithElements();
    const editor = rig.editors.get(A)!;
    caretAtEnd(editor);
    rig.type(A, 'hello world');
    await tick(1000);
    expect(runEditorCommand(editor, 'para.alignCenter', {})).toBe(true);
    await tick(1000);
    expect(align(rig)).toBe('center');
    expect(JSON.stringify((await held(rig)).paras)).toContain('center');

    await rig.queue.undo();
    await tick(1000);
    expect(align(rig)).toBeNull();
    expect((await held(rig)).markdown).toBe('hello world');
    expect(editor.state.doc.textContent).toBe('hello world');

    await rig.queue.redo();
    await tick(1000);
    expect(align(rig)).toBe('center');
    expect(editor.state.doc.textContent).toBe('hello world');
  });

  it('keeps the redo steps after undoing the typing too', async () => {
    const rig = await rigWithElements();
    const editor = rig.editors.get(A)!;
    caretAtEnd(editor);
    rig.type(A, 'hello world');
    await tick(1000);
    expect(runEditorCommand(editor, 'para.alignCenter', {})).toBe(true);
    await tick(1000);
    await rig.queue.undo();
    await tick(1000);
    await rig.queue.undo();
    await tick(1000);
    expect(editor.state.doc.textContent).toBe('');
    await rig.queue.redo();
    await tick(1000);
    await rig.queue.redo();
    await tick(1000);
    expect(editor.state.doc.textContent).toBe('hello world');
    expect(align(rig)).toBe('center');
  });

  it('sends the paragraph change in order before an undo that comes right after it', async () => {
    const rig = await rigWithElements();
    const editor = rig.editors.get(A)!;
    caretAtEnd(editor);
    rig.type(A, 'hello');
    await tick(1000);
    expect(runEditorCommand(editor, 'para.alignCenter', {})).toBe(true);
    await rig.queue.undo();
    await tick(1000);
    expect(align(rig)).toBeNull();
    expect(editor.state.doc.textContent).toBe('hello');
  });
});
