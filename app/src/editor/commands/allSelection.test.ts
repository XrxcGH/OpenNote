// @vitest-environment jsdom
// Ctrl+A makes an AllSelection. Its range starts and ends outside every textblock. Every character format must still
// reach the text in it (full walk A1-A04-2).
import { AllSelection, EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { clearFormatting, setHighlight, setTextSize, toggleMark } from './marks';
import { runEditorCommand } from './catalog';
import type { Command } from './command';
import { marksAllowed } from './state';
import { mountEditor, marked, markdownOf, stubLayout } from './testing';

function afterAll(command: Command, source = 'one\n\ntwo') {
  const base = EditorState.create({ doc: marked(source).state.doc });
  const state = base.apply(base.tr.setSelection(new AllSelection(base.doc)));
  let after: EditorState | null = null;
  const ran = command(state, (tr) => (after = state.apply(tr)));
  return ran && after ? markdownOf(after) : null;
}

describe('formats over the selection of every paragraph', () => {
  it('make all the text bold, italic, underlined, or struck', () => {
    expect(afterAll(toggleMark('bold'))).toBe('**one**\n\n**two**');
    expect(afterAll(toggleMark('italic'))).toBe('*one*\n\n*two*');
    expect(afterAll(toggleMark('strike'))).toBe('~~one~~\n\n~~two~~');
  });

  it('highlight and resize all the text', () => {
    expect(afterAll(setHighlight(null))).toContain('==one==');
    expect(afterAll(setTextSize('large'))).not.toBe('one\n\ntwo');
  });

  it('clear the format of all the text', () => {
    expect(afterAll(clearFormatting(), '**one**\n\n**two**')).toBe('one\n\ntwo');
  });
});

describe('Ctrl+A in an editor, then a format command', () => {
  it('formats all the text of the box (A1-A04-2)', () => {
    stubLayout();
    const mounted = mountEditor('one\n\ntwo');
    const { editor } = mounted;
    editor.commands.focus('end');
    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
    editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event));
    expect(editor.state.selection.from).toBe(0);
    expect(runEditorCommand(editor, 'format.bold')).toBe(true);
    expect(mounted.markdown()).toBe('**one**\n\n**two**');
    mounted.destroy();
  });
});

describe('marks allowed over the whole text', () => {
  it('is true for an AllSelection, so the format keys and bar buttons stay on (A1-A04-2)', () => {
    const base = EditorState.create({ doc: marked('one\n\ntwo').state.doc });
    const state = base.apply(base.tr.setSelection(new AllSelection(base.doc)));
    expect(marksAllowed(state)).toBe(true);
  });

  it('is false in a code block, and true across a code block and a paragraph', () => {
    const code = EditorState.create({ doc: marked('```\nx\n```').state.doc });
    expect(marksAllowed(code.apply(code.tr.setSelection(new AllSelection(code.doc))))).toBe(false);
    const both = EditorState.create({ doc: marked('one\n\n```\nx\n```').state.doc });
    expect(marksAllowed(both.apply(both.tr.setSelection(new AllSelection(both.doc))))).toBe(true);
  });
});
