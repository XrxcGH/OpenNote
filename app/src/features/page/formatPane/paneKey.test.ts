// @vitest-environment jsdom
// The pane skips typing at a caret and draws again for any change of the format it shows.
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { setAlign } from '../../../editor/commands/paragraph';
import { toggleRunMark } from '../../../editor/commands/runFormat';
import { mountEditor } from '../../../editor/commands/testing';
import type { TestEditor } from '../../../editor/commands/testing';
import { paneKey } from './paneKey';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

const run = (command: (s: never, d: never) => boolean) =>
  (command as unknown as (s: unknown, d: unknown) => boolean)(mounted!.editor.state, mounted!.editor.view.dispatch);

describe('paneKey', () => {
  it('does not change when a character is typed at the caret', () => {
    mounted = mountEditor('one two');
    const { editor } = mounted;
    editor.commands.setTextSelection(4);
    const before = paneKey(editor.state);
    editor.view.dispatch(editor.state.tr.insertText('x'));
    expect(before).not.toBeNull();
    expect(paneKey(editor.state)).toBe(before);
  });

  it('changes when the caret mark or the paragraph format changes', () => {
    mounted = mountEditor('one two');
    const { editor } = mounted;
    editor.commands.setTextSelection(4);
    const plain = paneKey(editor.state);
    run(toggleRunMark('bold') as never);
    const bold = paneKey(editor.state);
    expect(bold).not.toBe(plain);
    run(setAlign('center') as never);
    expect(paneKey(editor.state)).not.toBe(bold);
  });

  it('has no key for a range, which always draws again', () => {
    mounted = mountEditor('one two');
    const { editor } = mounted;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 4)));
    expect(paneKey(editor.state)).toBeNull();
  });
});
