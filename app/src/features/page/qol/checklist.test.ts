import { EditorState, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { createMarkdownCache, parseTextBlock, serializeTextBlock } from '../../../editor/markdown';
import {
  countTasks,
  finishedLast,
  finishedModeOf,
  inChecklist,
  moveFinishedToBottom,
  setAllChecked,
} from './checklist';

const stateFor = (markdown: string, at?: number) => {
  const doc = parseTextBlock(markdown);
  const state = EditorState.create({ doc });
  return at === undefined ? state : state.apply(state.tr.setSelection(TextSelection.near(doc.resolve(at))));
};
const markdownOf = (state: EditorState) => serializeTextBlock(state.doc, createMarkdownCache());

describe('checklist extras', () => {
  it('counts finished and total tasks', () => {
    expect(countTasks(parseTextBlock('- [x] a\n- [ ] b\n'))).toEqual({ done: 1, total: 2 });
    expect(countTasks(parseTextBlock('plain'))).toEqual({ done: 0, total: 0 });
  });

  it('checks and unchecks every item of the list at the caret', () => {
    const state = stateFor('- [ ] a\n- [x] b\n- [ ] c\n', 5);
    const tr = state.tr;
    expect(setAllChecked(tr, true)).toBe(true);
    const checked = state.apply(tr);
    expect(markdownOf(checked)).toBe('- [x] a\n- [x] b\n- [x] c');
    const tr2 = checked.tr;
    expect(setAllChecked(tr2, false)).toBe(true);
    expect(markdownOf(checked.apply(tr2))).toBe('- [ ] a\n- [ ] b\n- [ ] c');
  });

  it('does nothing outside a list', () => {
    const state = stateFor('just text', 3);
    expect(setAllChecked(state.tr, true)).toBe(false);
    expect(inChecklist(state.doc, 3)).toBe(false);
  });

  it('moves finished items to the bottom in order', () => {
    const state = stateFor('- [x] a\n- [ ] b\n- [x] c\n- [ ] d\n', 4);
    const tr = state.tr;
    expect(moveFinishedToBottom(tr)).toBe(true);
    expect(markdownOf(state.apply(tr))).toBe('- [ ] b\n- [ ] d\n- [x] a\n- [x] c');
    expect(moveFinishedToBottom(stateFor('- [ ] a\n- [x] b\n', 4).tr)).toBe(false);
  });

  it('keeps the caret in the item it was in', () => {
    const state = stateFor('- [x] one\n- [ ] two\n', 4);
    const tr = state.tr;
    moveFinishedToBottom(tr);
    expect(state.apply(tr).selection.$from.parent.textContent).toBe('one');
  });

  it('reads the finished-items choice', () => {
    expect(finishedLast([])).toBeNull();
    expect(finishedModeOf({ finished: 'hide' })).toBe('hide');
    expect(finishedModeOf({ finished: 'other' })).toBe('keep');
  });
});
