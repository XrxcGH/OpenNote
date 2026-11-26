// Insert page break in a real page: it splits the text at the caret, leaves the text alone when the core refuses the
// step, and Backspace after it removes it. The break block can take focus like an image.
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupPages, renderPage } from '../test/harness';
import { textPageFixture } from '../test/fixtures';
import { shownQueue } from '../sync';
import { insertBreak } from './insertBreak';
import { removeBreak } from './removeBreak';

afterEach(cleanupPages);

const BLOCK = '01k6f0000000000000000t0001';

async function mounted(markdown: string, caret: number) {
  const harness = await renderPage({ fixture: textPageFixture(markdown), flags: { 'text.layout': true } });
  const editor = harness.mounted.pool.mount(BLOCK, { kind: 'end' }, 'target');
  if (!editor) throw new Error('no editor');
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret)));
  editor.commands.focus();
  return { harness, editor };
}

describe('insert page break', () => {
  it('cuts the paragraph at the caret and moves the rest below the break', async () => {
    const { harness, editor } = await mounted('HelloWorld', 6);
    expect(await insertBreak('page')).toBe(true);
    expect(editor.state.doc.textContent).toBe('Hello');
    expect(harness.markdown(BLOCK)).toBe('Hello');
    const types = harness.mounted.layer.blocks().map((block) => block.type);
    expect(types).toEqual(['text', 'break', 'text']);
    expect(harness.mounted.layer.blocks()[2].data.markdown).toBe('World');
  });

  it('leaves the text as it was when the core refuses the step', async () => {
    const { harness, editor } = await mounted('HelloWorld', 6);
    vi.spyOn(shownQueue.get()!, 'send').mockRejectedValue(new Error('refused'));
    expect(await insertBreak('page')).toBe(false);
    expect(editor.state.doc.textContent).toBe('HelloWorld');
    expect(harness.mounted.layer.blocks()).toHaveLength(1);
  });

  it('removes the break on Backspace at the start of the text below it', async () => {
    const { harness } = await mounted('HelloWorld', 6);
    await insertBreak('page');
    const breakBlock = harness.mounted.layer.blocks()[1];
    const wrapper = harness.mounted.layer.view(breakBlock.id)?.element;
    expect(wrapper?.tabIndex).toBe(0);
    expect(await removeBreak({ breakBlock: breakBlock.id, block: harness.mounted.layer.blocks()[2].id })).toBe(true);
    expect(harness.mounted.layer.blocks().map((block) => block.type)).toEqual(['text', 'text']);
  });
});
