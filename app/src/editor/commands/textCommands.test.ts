// The text formatting commands of B10 (text DESIGN.md 4.1 and 4.2). Expected values come from the design's rules:
// Word's size list, the clear rules, the case rules, and R-MRK-27 for bold and weight.
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { changeCase, changeCaseText, nextCycleMode } from './changeCase';
import type { Command } from './command';
import { clearFormatting, growFont, nudgeFont, toggleMark } from './marks';
import { applyTo, marked, markdownOf } from './testing';
import { setRunMark, setRunValue, setWeight, toggleRunMark, weightChoices } from './runFormat';
import { nudgeSize, parseSizeInput, stepSize } from './sizes';

const COMMENT = '01k6syncb10ck0000000000001';

/** The state after a command over the whole document, or null when it doesn't apply. */
function runAll(source: string, command: Command, edit?: (state: EditorState) => EditorState): EditorState | null {
  let state = EditorState.create({ doc: marked(source).state.doc });
  if (edit) state = edit(state);
  state = state.apply(
    state.tr.setSelection(TextSelection.between(state.doc.resolve(1), state.doc.resolve(state.doc.content.size - 1))),
  );
  let after: EditorState | null = null;
  const ran = command(state, (tr) => (after = state.apply(tr)));
  return ran ? after : null;
}

const allMd = (source: string, command: Command) => {
  const after = runAll(source, command);
  return after ? markdownOf(after) : null;
};

/** The names of the marks on each character of the first textblock. */
function markNames(doc: PMNode): string[] {
  const names = new Set<string>();
  doc.descendants((node) => {
    if (node.isText) node.marks.forEach((mark) => names.add(mark.type.name));
    return true;
  });
  return [...names].sort();
}

describe('size steps', () => {
  it('grow and shrink by Word’s list', () => {
    const grow = (from: number) => stepSize(from, 1);
    expect([8, 10, 10.5, 13, 28, 72, 1630].map(grow)).toEqual([9, 10.5, 11, 14, 36, 80, 1638]);
    expect(stepSize(8, -1)).toBe(7);
    expect(stepSize(1, -1)).toBe(1);
    expect(stepSize(1638, 1)).toBe(1638);
  });

  it('plus and minus one point clamp to 1 and 1638', () => {
    expect(nudgeSize(11, 1)).toBe(12);
    expect(nudgeSize(1, -1)).toBe(1);
    expect(nudgeSize(1638, 1)).toBe(1638);
  });

  it('refuse a size box value outside 1 to 1638 or off the half-point grid', () => {
    expect(parseSizeInput('10.5')).toBe(10.5);
    expect([parseSizeInput('0'), parseSizeInput('1639'), parseSizeInput('10.25'), parseSizeInput('x')]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('step each run of a mixed selection on its own', () => {
    expect(allMd('<span data-size="10">a</span><span data-size="14">b</span>', growFont(1))).toBe(
      '<span data-size="10.5">a</span><span data-size="16">b</span>',
    );
    expect(applyTo('<span data-size="11">[a]</span>', nudgeFont(1))).toBe('<span data-size="12">a</span>');
    expect(applyTo('<span data-size="1">[a]</span>', nudgeFont(-1))).toBeNull();
    expect(applyTo('<span data-size="8">[a]</span>', growFont(-1))).toBe('<span data-size="7">a</span>');
  });

  it('start unsized text from the 12 point body', () => {
    expect(applyTo('[a]', growFont(1))).toBe('<span data-size="14">a</span>');
    expect(applyTo('<span data-size="large">[a]</span>', growFont(1))).toBe('<span data-size="16">a</span>');
  });
});

describe('run formats', () => {
  it('toggle bold on a half-bold selection makes it all bold', () => {
    expect(applyTo('[a **b**]', toggleMark('bold'))).toBe('**a b**');
  });

  it('set each run format, refusing values outside its grammar', () => {
    expect(applyTo('[a]', setRunValue('font', 'Georgia'))).toBe('<span data-font="Georgia">a</span>');
    expect(applyTo('[a]', toggleRunMark('caps', { caps: 'small' }))).toBe('<span data-caps="small">a</span>');
    expect(applyTo('[a]', setRunMark('strike', { line: 'double' }))).toBe('<del data-line="double">a</del>');
    expect(applyTo('[a]', setRunMark('underline', { line: 'wave', color: null }))).toBe('<u data-line="wave">a</u>');
    expect(applyTo('[a]', setRunValue('tracking', '1.5'))).toBe('<span data-tracking="1.5">a</span>');
    expect(applyTo('[a]', setRunValue('tracking', '0'))).toBeNull();
    expect(applyTo('[a]', setRunValue('scale', '100'))).toBeNull();
    expect(applyTo('[a]', setRunValue('font', ' bad'))).toBeNull();
    expect(applyTo('[a]', setRunMark('comment', { comment: COMMENT }))).toBeNull();
  });

  it('give Semibold weight 600, and Ctrl+B bold with no weight mark', () => {
    expect(applyTo('[a]', setWeight(600))).toBe('<span data-weight="600">a</span>');
    expect(applyTo('<span data-weight="600">[a]</span>', toggleMark('bold'))).toBe('**a**');
    expect(applyTo('**[a]**', setWeight(300))).toBe('<span data-weight="300">a</span>');
    expect(applyTo('<span data-weight="600">[a]</span>', setWeight(400))).toBe('a');
  });

  it('offer only the weights a family has', () => {
    expect(weightChoices([400, 700])).toEqual([400, 700]);
    expect(weightChoices()).toHaveLength(9);
    expect(applyTo('[a]', setWeight(600, [400, 700]))).toBeNull();
  });
});

describe('clear character formatting', () => {
  it('keeps links, code, comments, lang, the style, and paras', () => {
    const source =
      `<span lang="fr">**a** <span data-comment="${COMMENT}">c</span> ` +
      '[<span data-font="Georgia">l</span>](https://x.test) <span data-color="brick">`d`</span></span>';
    const after = runAll(source, clearFormatting(), (state) =>
      state.apply(state.tr.setNodeAttribute(0, 'align', 'center').setNodeAttribute(0, 'style', 'quote')),
    );
    expect(after).not.toBeNull();
    expect(markNames(after!.doc)).toEqual(['code', 'comment', 'lang', 'link']);
    expect(after!.doc.firstChild!.attrs.align).toBe('center');
    expect(after!.doc.firstChild!.attrs.style).toBe('quote');
  });
});

describe('change case', () => {
  it('follows the five modes', () => {
    expect(changeCaseText('hello world. new line', 'sentence')).toBe('Hello world. New line');
    expect(changeCaseText('hello world. new line', 'title')).toBe('Hello World. New Line');
    expect(changeCaseText('Ab', 'toggle')).toBe('aB');
    expect(changeCaseText('Hello', 'upper')).toBe('HELLO');
    expect(changeCaseText('Hello', 'lower')).toBe('hello');
  });

  it('uppercases i to a dotted capital I in Turkish', () => {
    expect(changeCaseText('istanbul', 'upper', 'tr')).toBe('İSTANBUL');
    expect(applyTo('<span lang="tr">[iz]</span>', changeCase('upper'))).toBe('<span lang="tr">İZ</span>');
  });

  it('keeps each run’s marks', () => {
    expect(applyTo('[ab **cd**]', changeCase('upper'))).toBe('AB **CD**');
  });

  it('cycles UPPERCASE, lowercase, then Capitalize Each Word or Sentence case', () => {
    expect(nextCycleMode('Mixed text')).toBe('upper');
    expect(nextCycleMode('MIXED TEXT')).toBe('lower');
    expect(nextCycleMode('mixed text')).toBe('title');
    expect(nextCycleMode('a sentence.')).toBe('sentence');
    expect(applyTo('[ab]', changeCase('cycle'))).toBe('Ab');
  });

  it('changes the word at a caret', () => {
    expect(applyTo('one t[]wo', changeCase('upper'))).toBe('one TWO');
  });
});
