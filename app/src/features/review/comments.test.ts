// Comments and their records (ADR 0086; spec 6.10: R-CMT-1, R-CMT-2). A comment's range is its marks, so it moves
// with its text. The review model sends each new mark's record in the same batch as the Markdown. It drops the
// records of marks that left (R-CMT-2: writers drop comments that no mark names).
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { marked, markdownOf } from '../../editor/commands/testing';
import { addComment, commentTarget, commentsAt, removeComment } from './comments';
import { ReviewModel, stageComment, stageSuggestion } from './model';
import { commentRanges } from './ranges';
import type { CommentJson } from './records';
import { readRecords } from './records';

const C1 = '01m3sbcmt0000000000000c001';
const C2 = '01m3sbcmt0000000000000c002';
const S1 = '01m3sbsgg0000000000000s001';
const AT = '2026-11-07T09:00:00.000Z';
const comment = (markdown: string): CommentJson => ({
  author: 'Avery Quinn',
  time: AT,
  markdown,
  replies: [],
  resolved: false,
});

describe('comment ranges', () => {
  it("a comment's range follows its text when text is inserted before it", () => {
    const { state } = marked('Plants [grow] fast');
    let now = state.apply(addComment(state, C1, commentTarget(state)!)!);
    const [before] = commentRanges(now.doc);
    expect(before.text).toBe('grow');
    now = now.apply(now.tr.insertText('Green ', 1));
    const [after] = commentRanges(now.doc);
    expect(after.text).toBe('grow');
    expect(after.from).toBe(before.from + 'Green '.length);
    expect(markdownOf(now)).toBe(`Green Plants <span data-comment="${C1}">grow</span> fast`);
  });

  it('comments the word at the caret when nothing is selected, and nothing between words', () => {
    const { state } = marked('Cells di[]vide often');
    expect(state.doc.textBetween(commentTarget(state)!.from, commentTarget(state)!.to)).toBe('divide');
    const space = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 'Cells '.length + 1)));
    // The caret right after a space and before a word still finds that word.
    expect(space.doc.textBetween(commentTarget(space)!.from, commentTarget(space)!.to)).toBe('divide');
  });

  it('nests two comments on the same text, lowest ID outermost (R-MRK-26), and deletes one alone', () => {
    const { state } = marked('A [shared] word');
    let now = state.apply(addComment(state, C2, commentTarget(state)!)!);
    now = now.apply(addComment(now, C1, commentTarget(state)!)!);
    expect(markdownOf(now)).toBe(`A <span data-comment="${C1}"><span data-comment="${C2}">shared</span></span> word`);
    expect(commentsAt(now.doc, 4)).toEqual([C2, C1]);
    now = now.apply(removeComment(now, C2)!);
    expect(markdownOf(now)).toBe(`A <span data-comment="${C1}">shared</span> word`);
  });
});

describe('review model', () => {
  it('sends a new comment record with the Markdown that names it, and drops it when the mark leaves', () => {
    const model = new ReviewModel();
    stageComment(C1, comment(''));
    const named = `See <span data-comment="${C1}">this</span>`;
    expect(model.rider('b1', 'See this', named)).toEqual([
      { edit: 'patchBlock', block: 'b1', data: { comments: { [C1]: comment('') } } },
    ]);
    expect(model.of('b1').comments[C1]).toEqual(comment(''));
    // A later batch with the same marks sends nothing more.
    expect(model.rider('b1', named, `${named}!`)).toEqual([]);
    expect(model.rider('b1', named, 'See this')).toEqual([
      { edit: 'patchBlock', block: 'b1', data: { comments: { [C1]: null } } },
    ]);
    // Undo in the editor brings the mark back, and the record comes with it.
    expect(model.rider('b1', 'See this', named)).toEqual([
      { edit: 'patchBlock', block: 'b1', data: { comments: { [C1]: comment('') } } },
    ]);
    model.dispose();
  });

  it('applies reply, resolve, and reopen patches, and reads records the core sends', () => {
    const model = new ReviewModel();
    model.setBlock('b1', {
      markdown: `<span data-comment="${C1}">x</span>`,
      comments: { [C1]: comment('Check this'), bad: comment('no') },
      suggestions: { [S1]: { kind: 'ins', author: 'Jordan Lee', time: AT } },
    });
    expect(Object.keys(model.of('b1').comments)).toEqual([C1]);
    const reply = { author: 'Jordan Lee', time: AT, markdown: 'Done' };
    model.apply('b1', { comments: { [C1]: { replies: [reply], resolved: true } } });
    expect(model.of('b1').comments[C1]).toEqual({ ...comment('Check this'), replies: [reply], resolved: true });
    model.apply('b1', { comments: { [C1]: { resolved: false } } });
    expect(model.comment(C1)?.record.resolved).toBe(false);
    expect(model.suggestion(S1)?.author).toBe('Jordan Lee');
    model.dispose();
  });

  it('sends a suggestion record with its insertion mark', () => {
    const model = new ReviewModel();
    const record = { kind: 'ins' as const, author: 'Avery Quinn', time: AT };
    stageSuggestion(S1, record);
    expect(model.rider('b2', 'Go', `Go <span data-ins="${S1}">on</span>`)).toEqual([
      { edit: 'patchBlock', block: 'b2', data: { suggestions: { [S1]: record } } },
    ]);
    model.dispose();
  });

  it('reads only valid records (R-CMT-1, R-SUG-1)', () => {
    const records = readRecords({
      comments: { [C1]: { author: 'A', time: AT, markdown: 'm', resolved: 'yes' }, [C2]: { author: '', time: AT } },
      suggestions: { [S1]: { kind: 'fmt', author: 'A', time: AT, before: '**x**' }, x: { kind: 'ins' } },
    });
    expect(records.comments).toEqual({ [C1]: { author: 'A', time: AT, markdown: 'm', replies: [], resolved: false } });
    expect(records.suggestions).toEqual({ [S1]: { kind: 'fmt', author: 'A', time: AT, before: '**x**' } });
  });
});

describe('a comment in an editor state', () => {
  it('cannot go into a code block', () => {
    const { state } = marked('```\ncode here\n```');
    const inCode = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 6)));
    expect(addComment(inCode, C1, { from: 2, to: 6 })).toBeNull();
    expect(EditorState).toBeDefined();
  });
});
