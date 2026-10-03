// @vitest-environment jsdom
// Keys between blocks on a real page: Escape and Ctrl+A select blocks as objects, arrows cross flowing blocks and
// stay in floating ones, Shift+Arrow escalates, and Backspace merges into the text block above in one batch.
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../registrations/editor';
import { ESCAPE_HINT_ID } from '../../../editor/extensions/crossBlock';
import { pageSelection } from '../seams/selectionStore';
import { textPageFixture } from '../test/fixtures';
import type { PageFixture } from '../test/fixtures';
import { cleanupPages, renderPage } from '../test/harness';

afterEach(async () => {
  await cleanupPages();
  pageSelection.set({ blocks: [], strokes: [] });
});

/** A page of flowing text blocks, one per string; `floating` gives the second one a frame. */
function blocksFixture(texts: readonly string[], floating = false): PageFixture {
  const fixture = textPageFixture(texts[0]);
  const blocks = texts.map((markdown, index) => {
    const one = fixture.page.blocks[0];
    const frame = floating && index === 1 ? { x: 400, y: 300, w: 200 } : one.frame;
    const id = `${one.id.slice(0, -1)}${index + 1}`;
    return { ...one, id, order: `a000${index}`, data: { markdown }, ...(frame ? { frame } : {}) };
  });
  return { page: { ...fixture.page, blocks } };
}

async function open(texts: readonly string[], floating = false) {
  const fixture = blocksFixture(texts, floating);
  const page = await renderPage({ fixture });
  const ids = fixture.page.blocks.map((block) => block.id);
  // The pool mounts editors as they are needed, so the test asks for each one it presses keys in.
  const editor = (index: number) => page.mounted.pool.mount(ids[index], null, 'focus')!;
  return { page, ids, editor };
}

function press(editor: Editor, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  return editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event)) ?? false;
}

describe('keys between blocks', () => {
  it('describe every editor by the Escape hint', async () => {
    const { editor } = await open(['one']);
    expect(editor(0).view.dom.getAttribute('aria-describedby')).toBe(ESCAPE_HINT_ID);
    expect(document.getElementById(ESCAPE_HINT_ID)?.textContent).toBe('Press Escape, then Tab, to leave the text box.');
  });

  it('select the block as an object on Escape', async () => {
    const { ids, editor } = await open(['one', 'two']);
    expect(press(editor(1), 'Escape')).toBe(true);
    expect(pageSelection.get().blocks).toEqual([ids[1]]);
  });

  it('select the text on Ctrl+A, then every block', async () => {
    const { ids, editor } = await open(['one', 'two']);
    editor(0).commands.setTextSelection(2);
    press(editor(0), 'a', { ctrlKey: true });
    expect(pageSelection.get().blocks).toEqual([]);
    editor(0).commands.selectAll();
    expect(press(editor(0), 'a', { ctrlKey: true })).toBe(true);
    expect(pageSelection.get().blocks).toEqual(ids);
  });

  it('move down into the next flowing block from the last line', async () => {
    const { editor } = await open(['one', 'two']);
    editor(0).commands.focus('end', { scrollIntoView: false });
    // jsdom has no layout, so the caret counts as on the last line.
    editor(0).view.endOfTextblock = () => true;
    expect(press(editor(0), 'ArrowDown')).toBe(true);
    expect(document.activeElement).toBe(editor(1).view.dom);
  });

  it('select both blocks on Shift+Arrow past the edge', async () => {
    const { ids, editor } = await open(['one', 'two']);
    editor(1).commands.focus('start', { scrollIntoView: false });
    expect(press(editor(1), 'ArrowUp', { shiftKey: true })).toBe(true);
    expect(pageSelection.get().blocks).toEqual(ids);
  });

  it('stay inside a floating text box', async () => {
    const { editor } = await open(['one', 'two'], true);
    editor(1).commands.focus('end', { scrollIntoView: false });
    expect(press(editor(1), 'ArrowUp')).toBe(false);
  });

  it('merge into the text block above on Backspace at the start, in one batch', async () => {
    const { page, ids, editor } = await open(['one', 'two']);
    editor(1).commands.focus('start', { scrollIntoView: false });
    expect(press(editor(1), 'Backspace')).toBe(true);
    expect(pageSelection.get().blocks).toEqual([]);
    await vi.waitFor(() => expect(editor(0).state.doc.textContent).toBe('onetwo'));
    await page.mounted.sync.flushAll('command');
    expect(page.markdown(ids[0])).toBe('onetwo');
    const batch = page.sent().find((sent) => sent.edits.some((edit) => edit.edit === 'deleteBlocks'));
    // The text goes as a splice when the core takes them, and as the whole text otherwise.
    const textEdit: unknown = expect.stringMatching(/^(setText|spliceText)$/);
    expect(batch?.edits.map((edit) => edit.edit)).toEqual([textEdit, 'deleteBlocks']);
  });
});
