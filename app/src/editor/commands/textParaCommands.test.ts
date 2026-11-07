// @vitest-environment jsdom
// Paragraph and list commands, repeat, select similar, and speak formatting (text DESIGN.md 4.1 and 4.2). Expected
// values come from the design: Word's 36 point tab stops, Ctrl+0's 12 points, the list library's looks.
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { META_ELEMENT_DATA } from '../meta';
import { runEditorCommand } from './catalog';
import type { Command } from './command';
import {
  applyBullet,
  applyMultilevel,
  applyNumberLook,
  continueNumbering,
  labelAt,
  restartNumbering,
  setNumberingValue,
} from './lists';
import { toggleMark } from './marks';
import {
  clearAll,
  hangingIndent,
  indentParagraph,
  nextTabStop,
  resetParagraph,
  setAlign,
  setLineMultiple,
  toggleSpaceBefore,
  validParaValue,
} from './paragraph';
import { forgetRepeatable } from './repeat';
import { RangesSelection, selectSimilar, similarRanges } from './similar';
import { describeFormat } from './speakFormat';
import { marked, markdownOf, mountEditor } from './testing';
import type { TestEditor } from './testing';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
  forgetRepeatable();
});

/** Runs a command on marked Markdown; returns the state after it and its transaction. */
function run(source: string, command: Command, prepare?: (state: EditorState) => EditorState) {
  let { state } = marked(source);
  if (prepare) state = prepare(state);
  let tr: Transaction | null = null;
  const ran = command(state, (made) => (tr = made));
  return ran && tr ? { state: state.apply(tr), tr: tr as Transaction } : null;
}

const attrsOf = (state: EditorState, index = 0) => state.doc.child(index).attrs;

describe('paragraph commands', () => {
  it('align, with start as no key, in one transaction that asks the writer to save', () => {
    const centered = run('[a]', setAlign('center'))!;
    expect(attrsOf(centered.state).align).toBe('center');
    expect(centered.tr.getMeta(META_ELEMENT_DATA)).toBe(true);
    const back = run('[a]', setAlign('start'), () => centered.state);
    expect(attrsOf(back!.state).align).toBeNull();
    expect(run('[a]', setAlign('start'))).toBeNull();
  });

  it('set line spacing and toggle 12 points before', () => {
    expect(attrsOf(run('[a]', setLineMultiple(1.5))!.state).line).toEqual({ rule: 'multiple', value: 1.5 });
    const open = run('[a]', toggleSpaceBefore())!.state;
    expect(attrsOf(open).before).toBe(12);
    expect(attrsOf(run('[a]', toggleSpaceBefore(), () => open)!.state).before).toBeNull();
  });

  it('indent to the next 36 point stop, and hang the first line', () => {
    expect([
      nextTabStop(0, 1),
      nextTabStop(10, 1),
      nextTabStop(36, 1),
      nextTabStop(40, -1),
      nextTabStop(0, -1),
    ]).toEqual([36, 36, 72, 36, 0]);
    const indented = run('[a]', indentParagraph(1))!.state;
    expect(attrsOf(indented).indent).toEqual({ start: 36, end: 0, first: 0 });
    expect(attrsOf(run('[a]', indentParagraph(-1), () => indented)!.state).indent).toBeNull();
    expect(attrsOf(run('[a]', hangingIndent(1))!.state).indent).toEqual({ start: 36, end: 0, first: -36 });
  });

  it('set a list item’s formatting on the item', () => {
    const { state } = run('- [a]', setAlign('center'))!;
    expect(state.doc.child(0).child(0).attrs.align).toBe('center');
  });

  it('refuse values a reader would drop', () => {
    expect(validParaValue('align', 'left')).toBe(false);
    expect(validParaValue('before', 2000)).toBe(false);
    expect(validParaValue('before', 6)).toBe(true);
  });

  it('reset paragraph formatting, keeping the list an item names', () => {
    const prepare = (state: EditorState) =>
      state.apply(state.tr.setNodeAttribute(0, 'align', 'center').setNodeAttribute(0, 'before', 6));
    const { state } = run('[a]', resetParagraph(), prepare)!;
    expect([attrsOf(state).align, attrsOf(state).before]).toEqual([null, null]);
  });

  it('clear all: marks, paragraph formatting, style, and heading', () => {
    const prepare = (state: EditorState) =>
      state.apply(state.tr.setNodeAttribute(0, 'align', 'center').setNodeAttribute(0, 'style', 'quote'));
    const { state } = run('## **[a]**', clearAll(), prepare)!;
    expect(markdownOf(state)).toBe('a');
    expect([attrsOf(state).align, attrsOf(state).style]).toEqual([null, null]);
  });
});

describe('list commands', () => {
  const labels = (test: TestEditor, positions: number[]) =>
    positions.map((pos) => {
      test.editor.commands.setTextSelection(pos);
      return labelAt(test.editor.state);
    });

  it('apply a look from the numbering library', () => {
    mounted = mountEditor('1. [one]\n2. two');
    expect(runEditorCommand(mounted.editor, 'list.numberLook', { value: 'upperRoman' })).toBe(true);
    expect(labels(mounted, [3, 10])).toEqual(['I.', 'II.']);
    expect(mounted.host.announced.at(-1)).toBe('Numbering I.');
  });

  it('apply a bullet, and turn a numbered list into bullets for it', () => {
    mounted = mountEditor('1. [one]');
    expect(mounted.editor.commands.command(({ state, dispatch }) => applyBullet('➢')(state, dispatch))).toBe(true);
    expect(labelAt(mounted.editor.state)).toBe('➢');
    expect(applyBullet('ab')(mounted.editor.state)).toBe(false);
  });

  it('apply legal multilevel numbering', () => {
    mounted = mountEditor('1. [a]\n   1. b');
    mounted.editor.commands.command(({ state, dispatch }) => applyMultilevel('legal')(state, dispatch));
    expect(labels(mounted, [3, 8])).toEqual(['1.', '1.1.']);
  });

  it('restart at 1, continue, and set a value', () => {
    mounted = mountEditor('1. a\n2. [b]\n3. c');
    const at = (command: Command) =>
      mounted!.editor.commands.command(({ state, dispatch }) => command(state, dispatch));
    expect(at(restartNumbering())).toBe(true);
    expect(labels(mounted, [3, 8, 13])).toEqual(['1.', '1.', '2.']);
    mounted.editor.commands.setTextSelection(8);
    expect(at(continueNumbering())).toBe(true);
    expect(labels(mounted, [3, 8, 13])).toEqual(['1.', '2.', '3.']);
    mounted.editor.commands.setTextSelection(8);
    expect(at(setNumberingValue(5))).toBe(true);
    expect(labels(mounted, [3, 8, 13])).toEqual(['1.', '5.', '6.']);
  });

  it('continue from the numbered list before', () => {
    mounted = mountEditor('1. a\n2. b\n\npara\n\n1. [c]');
    const pos = mounted.editor.state.selection.from;
    mounted.editor.commands.command(({ state, dispatch }) => continueNumbering()(state, dispatch));
    expect(labels(mounted, [pos])).toEqual(['3.']);
  });

  it('write a new definition for the writer to save', () => {
    const { tr } = run('1. [one]', applyNumberLook('lowerLetterParen'))!;
    const meta = tr.getMeta(META_ELEMENT_DATA) as { lists: Record<string, { levels: unknown[] }> };
    expect(Object.values(meta.lists)).toEqual([{ levels: [{ format: 'lowerLetter', text: '%1)' }] }]);
  });
});

describe('repeat, select similar, and speak formatting', () => {
  it('repeat the last formatting command on a new selection', () => {
    mounted = mountEditor('[one] two');
    runEditorCommand(mounted.editor, 'format.font', { value: 'Georgia' });
    mounted.editor.commands.setTextSelection({ from: 5, to: 8 });
    expect(runEditorCommand(mounted.editor, 'format.repeat')).toBe(true);
    expect(mounted.markdown()).toBe('<span data-font="Georgia">one</span> <span data-font="Georgia">two</span>');
  });

  it('select every range with the formatting at the caret, so a format applies to all', () => {
    const { state } = marked('**[]a** b **c**');
    expect(similarRanges(state)).toEqual([
      { from: 1, to: 2 },
      { from: 5, to: 6 },
    ]);
    const selected = run('**[]a** b **c**', selectSimilar())!.state;
    expect(selected.selection).toBeInstanceOf(RangesSelection);
    const after = run('x', toggleMark('italic'), () => selected)!.state;
    expect(markdownOf(after)).toBe('***a*** b ***c***');
    // Only the ranges count, so bold is on for the selection and the toggle takes it off both.
    expect(markdownOf(run('x', toggleMark('bold'), () => selected)!.state)).toBe('a b c');
  });

  it('speak the formatting at the caret', () => {
    const source =
      '## **<span data-color="brick"><span data-font="Georgia"><span data-size="13">[]x</span></span></span>**';
    const prepare = (state: EditorState) => state.apply(state.tr.setNodeAttribute(0, 'align', 'center'));
    const { state } = marked(source);
    const caret = prepare(state);
    const at = caret.apply(caret.tr.setSelection(TextSelection.create(caret.doc, 2)));
    expect(describeFormat(at)).toBe('Georgia, 13 points, bold, color Brick, Heading 2, Centered');
    expect(describeFormat(EditorState.create({ doc: marked('x').state.doc }))).toBe('No formatting');
  });
});
