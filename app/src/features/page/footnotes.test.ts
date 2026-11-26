// @vitest-environment jsdom
// Footnotes and endnotes on a page (ADR 0087): numbers follow the reading order across text blocks, and a reference
// and its note change in one undo step.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../editor/commands/testing';
import { createEditorHost } from './editorHost';
import { insertNote } from '../../editor/notes/commands';
import { NotesModel } from '../../editor/notes/model';
import { readNotes } from '../../editor/notes/refs';
import type { BlockJson, EditBatch } from '../../services/pages/types';
import { readingOrder } from './readingOrder/order';
import { blockId, syncPage, syncRig } from './sync/testSync';
import { addTextRider } from './sync/textSync';
import type { MountedPage } from './pagesApi';
import { attachNotes } from './footnotes/notes';

vi.mock('../../ui/toast', () => ({ showToast: vi.fn() }));

const note = (n: number) => `01m3sbcmt0000000000000n${String(n).padStart(3, '0')}`;
const AT = '2026-10-01T09:00:00.000Z';

function textBlock(id: string, order: string, markdown: string, notes: Record<string, unknown>): BlockJson {
  return { id, type: 'text', order, created: AT, modified: AT, data: { markdown, notes } };
}

/** A page view with just what the notes read: blocks in reading order, the flow column, and a sync that records. */
function fakePage(initial: BlockJson[]) {
  let blocks = initial;
  const listeners = new Set<() => void>();
  const world = document.body.appendChild(document.createElement('div'));
  const flow = world.appendChild(document.createElement('div'));
  const sent: EditBatch[] = [];
  const mounted = {
    layer: {
      blocks: () => readingOrder(blocks).map((id) => blocks.find((block) => block.id === id)!),
      block: (id: string) => blocks.find((block) => block.id === id) ?? null,
      view: () => null,
      onChange(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    page: { initial: { view: {} }, readOnly: null, onFrame: () => () => undefined },
    sync: {
      send: (batch: EditBatch) => {
        sent.push(batch);
        return Promise.resolve();
      },
      onStep: () => () => undefined,
    },
    pool: { mount: () => null, editor: () => null },
    flow: { element: flow },
    viewport: { world },
    host: createEditorHost(),
  } as unknown as MountedPage;
  return {
    mounted,
    sent,
    move(id: string, order: string) {
      blocks = blocks.map((block) => (block.id === id ? { ...block, order } : block));
      listeners.forEach((listener) => listener());
    },
  };
}

afterEach(() => document.body.replaceChildren());

describe('note numbers', () => {
  it('numbers three references in two text blocks 1, 2, 3 in reading order, and again after a move', () => {
    const foot = (markdown: string) => ({ kind: 'foot', markdown });
    const A = textBlock(blockId(1), 'a0', `One[^${note(1)}] two[^${note(2)}]`, {
      [note(1)]: foot('First'),
      [note(2)]: foot('Second'),
    });
    const B = textBlock(blockId(2), 'a1', `Three[^${note(3)}]`, { [note(3)]: foot('Third') });
    const page = fakePage([A, B]);
    const notes = attachNotes(page.mounted);
    const labels = () => {
      const { byId } = notes.view.refreshNow();
      return [note(1), note(2), note(3)].map((id) => byId.get(id)?.label);
    };
    expect(labels()).toEqual(['1', '2', '3']);
    const sheet = document.querySelector('style[data-notes]')!.textContent!;
    expect(sheet).toContain(`[data-footnote="${note(3)}"]::after{content:"3" / "Footnote 3"}`);
    const listed = () => [...notes.view.element.querySelectorAll('li')].map((li) => li.textContent);
    expect(listed()).toEqual(['1First', '2Second', '3Third']);

    // The second block moves above the first.
    page.move(blockId(2), '0');
    expect(labels()).toEqual(['2', '3', '1']);
    expect(listed()).toEqual(['1Third', '2First', '3Second']);
    notes.detach();
    expect(document.querySelector('style[data-notes]')).toBeNull();
  });

  it('sends a format change to the page view and draws the new labels', () => {
    const A = textBlock(blockId(1), 'a0', `x[^${note(1)}] y[^${note(2)}]`, {
      [note(1)]: { kind: 'end', markdown: 'E1' },
      [note(2)]: { kind: 'end', markdown: 'E2' },
    });
    const page = fakePage([A]);
    const notes = attachNotes(page.mounted);
    expect(notes.view.refreshNow().end.map((item) => item.label)).toEqual(['i', 'ii']);
    const set = notes.view.element.querySelector<HTMLElement>('fieldset[data-kind="end"]')!;
    set.querySelector<HTMLSelectElement>('[data-field="format"]')!.value = 'upperLetter';
    set.dispatchEvent(new Event('change'));
    expect(page.sent.at(-1)!.edits[0]).toEqual({
      edit: 'setPage',
      view: { text: { notes: { end: { format: 'upperLetter', start: 1, restart: 'continuous' } } } },
    });
    expect(notes.view.refreshNow().end.map((item) => item.label)).toEqual(['A', 'B']);
    notes.detach();
  });
});

describe('notes and undo', () => {
  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  let stop: () => void = () => undefined;
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  async function rigWithNote() {
    const page = syncPage([`Text[^${note(1)}] more`]);
    page.blocks[0]!.data.notes = { [note(1)]: { kind: 'foot', markdown: 'Note text' } };
    const rig = await syncRig(page);
    const model = new NotesModel();
    model.setBlock(blockId(1), readNotes(page.blocks[0]!.data));
    stop = addTextRider((block, before, after) => model.rider(block, before, after));
    const held = async () => (await rig.held()).blocks.find((block) => block.id === blockId(1))!.data;
    return { rig, model, held };
  }

  it('restores both the reference and the note text when a deleted reference is undone', async () => {
    const { rig, held } = await rigWithNote();
    const editor = rig.editors.get(blockId(1))!;
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'footnoteRef') at = pos;
    });
    editor.view.dispatch(editor.state.tr.delete(at, at + 1));
    await tick(500);
    const deleted = await held();
    expect(deleted.markdown).not.toContain('[^');
    expect((deleted.notes as Record<string, unknown>)[note(1)]).toBeUndefined();

    await rig.queue.undo();
    await tick(500);
    const restored = await held();
    expect(restored.markdown).toContain(`[^${note(1)}]`);
    expect((restored.notes as Record<string, { markdown: string }>)[note(1)]!.markdown).toBe('Note text');
  });

  it('inserts an endnote and its note in one step', async () => {
    const { rig, model, held } = await rigWithNote();
    const editor = rig.editors.get(blockId(1))!;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const id = insertNote(editor, model, 'end')!;
    await tick(500);
    const inserted = await held();
    expect(inserted.markdown).toContain(`[^${id}]`);
    expect((inserted.notes as Record<string, unknown>)[id]).toEqual({ kind: 'end', markdown: '' });

    await rig.queue.undo();
    await tick(500);
    const undone = await held();
    expect(undone.markdown).not.toContain(`[^${id}]`);
    expect((undone.notes as Record<string, unknown>)[id]).toBeUndefined();
    expect((undone.notes as Record<string, unknown>)[note(1)]).toBeDefined();
  });
});
