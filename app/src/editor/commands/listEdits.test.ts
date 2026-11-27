// @vitest-environment jsdom
// The failures blockFuzz.test.ts found, each kept as a case of its own. The first is the nightly soak's (seed 91):
// an undo gave the editor its old caret back by number, the number pointed at the end of a list, and Enter there
// threw "Cannot join bulletList onto paragraph".
import type { Editor, JSONContent } from '@tiptap/core';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runEditorCommand } from './catalog';
import { mountEditor, pressKey, stateProblem, typeInto } from './testing';
import type { TestEditor } from './testing';

let mounted: TestEditor;
beforeAll(() => {
  mounted = mountEditor('[]x');
});
afterAll(() => mounted.destroy());

const p = (word = ''): JSONContent => ({ type: 'paragraph', content: word ? [{ type: 'text', text: word }] : [] });
const item = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });
const bullets = (...items: JSONContent[]): JSONContent => ({ type: 'bulletList', content: items });
const quote = (...content: JSONContent[]): JSONContent => ({ type: 'blockquote', content });
const callout = (title: string, ...content: JSONContent[]): JSONContent => ({
  type: 'callout',
  content: [{ type: 'calloutTitle', content: [{ type: 'text', text: title }] }, ...content],
});

/** The document as nested type names and text, e.g. "bulletList(listItem(paragraph(cd)))". */
function shape(editor: Editor): string {
  const walk = (node: JSONContent): string =>
    node.type === 'text' ? (node.text ?? '') : `${node.type}(${(node.content ?? []).map(walk).join(',')})`;
  return (editor.getJSON().content ?? []).map(walk).join(',');
}

function load(content: JSONContent[], anchor: number | 'all', head = anchor): Editor {
  const { editor } = mounted;
  editor.commands.setContent({ type: 'doc', content });
  const { doc } = editor.state;
  const selection =
    anchor === 'all' ? new AllSelection(doc) : TextSelection.create(doc, anchor, head === 'all' ? anchor : head);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
  return editor;
}

describe('list edits the random test broke', () => {
  it('gives a caret placed by number a place in text, where Enter splits (the soak, seed 91)', () => {
    const { editor } = mounted;
    // "ab", then a list of "cd" and "ef", then "gh". Position 17 is the end of the list, after its last item.
    const content = [p('ab'), bullets(item(p('cd')), item(p('ef'))), p('gh')];
    editor.commands.setContent({ type: 'doc', content });
    const size = editor.state.doc.content.size;
    for (let at = 0; at <= size; at += 1) {
      editor.commands.setContent({ type: 'doc', content });
      editor.commands.setTextSelection({ from: 0, to: at });
      expect(stateProblem(editor), `range to ${at}`).toBeNull();
      editor.commands.setTextSelection(at);
      expect(stateProblem(editor), `caret at ${at}`).toBeNull();
      expect(() => pressKey(editor, 'Enter'), `Enter at ${at}`).not.toThrow();
      expect(stateProblem(editor), `after Enter at ${at}`).toBeNull();
    }
    // A number past the end, as a reload can give back after the note got shorter, lands at the end of the text.
    editor.commands.setContent({ type: 'doc', content });
    editor.commands.setTextSelection(size + 40);
    expect(editor.state.selection.from).toBe(size - 1);
  });
  it('deletes from a callout title into a quote that holds a list', () => {
    // callout("gh", ""), quote(bullets("ef", "gh")), "cd": from the end of the title (4) to the start of "ef" (12).
    const editor = load([callout('gh', p()), quote(bullets(item(p('ef')), item(p('gh')))), p('cd')], 4, 12);
    expect(() => pressKey(editor, 'Backspace')).not.toThrow();
    expect(stateProblem(editor)).toBeNull();
    expect(shape(editor)).toBe(
      'callout(calloutTitle(ghef)),blockquote(bulletList(listItem(paragraph(gh)))),paragraph(cd)',
    );
  });

  it('types over a selection from a quote into a callout title', () => {
    // quote("cd"), callout("gh", "ef"): from after "c" (3) to after "g" (9).
    const editor = load([quote(p('cd')), callout('gh', p('ef'))], 3, 9);
    expect(() => typeInto(editor, 'x')).not.toThrow();
    expect(stateProblem(editor)).toBeNull();
    expect(shape(editor)).toBe('blockquote(paragraph(cxh)),callout(calloutTitle(),paragraph(ef))');
  });

  it('turns the last item of a nested list at the end of the note into a heading', () => {
    // bullets("ab", numbers("cd", "")): the caret in the empty last item (15). The item is lifted out of both lists
    // first, and its position was then mapped through the lifts a second time, past the end of the note.
    const numbers = { type: 'orderedList', content: [item(p('cd')), item(p())] };
    const editor = load([bullets(item(p('ab'), numbers))], 15);
    expect(() => runEditorCommand(editor, 'block.turnInto', { kind: 'heading2' })).not.toThrow();
    expect(stateProblem(editor)).toBeNull();
    expect(shape(editor)).toBe('bulletList(listItem(paragraph(ab),orderedList(listItem(paragraph(cd))))),heading()');
  });

  it('clears all formatting from styled list items, the style too', () => {
    // bullets("ab", "cd"), "gh", each with a named style, the two items selected. Clear all lifts them out of the list
    // first. The style was then taken off at positions mapped through the lift a second time.
    const styled = (word: string): JSONContent => ({ ...p(word), attrs: { style: 'Note' } });
    const editor = load([bullets(item(styled('ab')), item(styled('cd'))), styled('gh')], 3, 11);
    expect(() => runEditorCommand(editor, 'format.clearAll')).not.toThrow();
    expect(stateProblem(editor)).toBeNull();
    expect(shape(editor)).toBe('paragraph(ab),paragraph(cd),paragraph(gh)');
    const styles: unknown[] = [];
    editor.state.doc.descendants((node) => void (node.isTextblock && styles.push(node.attrs.style)));
    expect(styles).toEqual([null, null, 'Note']);
  });

  it('moves a list item down with the whole note selected', () => {
    const editor = load([bullets(item(p('ab')), item(p('cd'))), p('gh')], 'all');
    expect(() => runEditorCommand(editor, 'outline.moveDown')).not.toThrow();
    expect(stateProblem(editor)).toBeNull();
    expect(editor.state.selection).toBeInstanceOf(AllSelection);
  });

  it('moves an item down with a selection that reaches past it, keeping both ends in text', () => {
    // bullets("ab", "cd"), "gh": from before "a" (3) to after "g" (16). The item "ab" moves, "g" stays.
    const editor = load([bullets(item(p('ab')), item(p('cd'))), p('gh')], 3, 16);
    runEditorCommand(editor, 'outline.moveDown');
    expect(stateProblem(editor)).toBeNull();
    expect(shape(editor)).toBe('bulletList(listItem(paragraph(cd)),listItem(paragraph(ab))),paragraph(gh)');
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe('abg');
  });

  it('changes case with the whole note selected and keeps it selected', () => {
    const editor = load([bullets(item(p('ab'))), p('cd')], 'all');
    runEditorCommand(editor, 'format.changeCase', { value: 'upper' });
    expect(stateProblem(editor)).toBeNull();
    expect(editor.state.selection).toBeInstanceOf(AllSelection);
  });
});
