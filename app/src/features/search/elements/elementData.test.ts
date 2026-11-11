// @vitest-environment jsdom
// The elements writer saves what the list and paragraph commands change (text DESIGN.md 2.3 and 4.2).
// A new list definition goes out in `lists`, and a block that had no element data starts saving `paras`. A failed
// send keeps the list definitions for the next save, so a list look or an alignment never vanishes on reload.
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEditorCommand } from '../../../editor/commands/catalog';
import { marked, testHost } from '../../../editor/commands/testing';
import { createBlockEditor, editorExtensions } from '../../../editor/extensions/kit';
import { shownMounted } from '../../page';
import type { MountedPage } from '../../page';
import { elementExtensions } from './plugin';

editorExtensions.register({
  id: 'test.elements',
  order: 91,
  kinds: ['text'],
  create: (host) => elementExtensions(host, { tags: false, links: true }),
});

type Sent = { edits: { edit: string; block: string; data: Record<string, unknown> }[] };

let send: ReturnType<typeof vi.fn<(sent: Sent) => Promise<unknown>>>;
let editor: Editor | null = null;
let wrapper: HTMLElement | null = null;
let block = '';
let blocks = 0;

beforeEach(() => {
  // A new block each time: the writer remembers what it last sent for each block.
  blocks += 1;
  block = `b-elements-${blocks}`;
  send = vi.fn<(sent: Sent) => Promise<unknown>>(() => Promise.resolve());
  shownMounted.set({
    page: { id: 'p-elements', send, onFrame: () => () => undefined },
    layer: { block: () => ({ data: undefined }) },
  } as unknown as MountedPage);
});

afterEach(() => {
  editor?.destroy();
  wrapper?.remove();
  editor = null;
  wrapper = null;
  shownMounted.set(null);
  vi.useRealTimers();
});

/** A text block with no element data, inside its block element as on a page. */
async function mount(source: string): Promise<Editor> {
  const { state } = marked(source);
  wrapper = document.body.appendChild(document.createElement('div'));
  wrapper.dataset.blockId = block;
  const root = wrapper.appendChild(document.createElement('div'));
  editor = createBlockEditor(root, state.doc, { kind: 'text', block, host: testHost() });
  editor.commands.setTextSelection({ from: state.selection.anchor, to: state.selection.head });
  await Promise.resolve();
  return editor;
}

/** The data of every patchBlock sent so far. */
const patches = () => send.mock.calls.map(([sent]) => sent.edits[0]).filter((edit) => edit.edit === 'patchBlock');

describe('the elements writer saves list and paragraph commands', () => {
  it('sends the new list definition and the item that uses it', async () => {
    const ed = await mount('1. [one]');
    vi.useFakeTimers();
    expect(runEditorCommand(ed, 'list.numberLook', { value: 'upperRoman' })).toBe(true);
    vi.advanceTimersByTime(1000);
    const [patch] = patches();
    expect(patch.block).toBe(block);
    const lists = patch.data.lists as Record<string, { levels: { format: string }[] }>;
    const [id] = Object.keys(lists);
    expect(lists[id].levels[0].format).toBe('upperRoman');
    const paras = Object.values(patch.data.paras as Record<string, { list?: { id: string } }>);
    expect(paras.map((entry) => entry.list?.id)).toEqual([id]);
  });

  it('starts saving paras for a block that had no element data', async () => {
    const ed = await mount('[one]');
    vi.useFakeTimers();
    expect(runEditorCommand(ed, 'para.alignCenter')).toBe(true);
    vi.advanceTimersByTime(1000);
    const [patch] = patches();
    expect(Object.values(patch.data.paras as Record<string, unknown>)).toEqual([{ align: 'center' }]);
  });

  it('keeps the list definitions when the send fails, and sends them with the next change', async () => {
    send.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    const ed = await mount('1. [one]');
    vi.useFakeTimers();
    runEditorCommand(ed, 'list.numberLook', { value: 'upperRoman' });
    vi.advanceTimersByTime(1000);
    const failed = patches()[0].data.lists as Record<string, unknown>;
    await vi.runAllTimersAsync();
    expect(runEditorCommand(ed, 'para.alignCenter')).toBe(true);
    vi.advanceTimersByTime(1000);
    const retried = patches()[1];
    expect(retried.data.lists).toEqual(failed);
  });
});
