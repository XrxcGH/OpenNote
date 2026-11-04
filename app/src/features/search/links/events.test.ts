// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { CommandContext } from '../../../commands/types';
import { editorHasFocus, focusedEditor } from './events';

const palette = { source: 'palette', focusZone: 'textInput' } as CommandContext;

describe('editorHasFocus', () => {
  it('stays true for the palette while the palette holds focus and the editor had it before', () => {
    document.body.innerHTML =
      '<div class="ProseMirror" contenteditable="true" tabindex="0"></div><div data-scope="palette"><input id="q"></div>';
    const editor = document.querySelector<HTMLElement>('.ProseMirror')!;
    editor.focus();
    expect(editorHasFocus()).toBe(true);
    document.querySelector<HTMLElement>('#q')!.focus();
    expect(editorHasFocus()).toBe(false);
    expect(editorHasFocus(palette)).toBe(true);
    expect(focusedEditor()).toBe(editor);
  });

  it('is false for the palette when focus was not in an editor', () => {
    document.body.innerHTML = '<button id="b"></button>';
    expect(editorHasFocus({ source: 'palette', focusZone: 'none' } as CommandContext)).toBe(false);
  });
});
