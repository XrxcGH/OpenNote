// @vitest-environment jsdom
// Suggesting mode and accept or reject (ADR 0086). The expected Markdown follows spec 7.10 (R-MRK-20 to R-MRK-22:
// `<span data-ins="ID">`, `<span data-del="ID">`, `<span data-fmt="ID">`). It also follows the rules in the ADR.
// Typing makes one insertion with the person's name. A deletion stays as a deletion mark. Accept or reject settles
// them.
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { marked, markdownOf, mountEditor, typeInto } from '../../editor/commands/testing';
import type { TestEditor } from '../../editor/commands/testing';
import { decide, nextChange, pick } from './changes';
import { findSuggestion } from './model';
import { changeRanges } from './ranges';
import type { SuggestionJson } from './records';
import { setReviewPrefs, suggesting } from './state';
import { suggestingPlugin, suggestionAtCaret } from './extension';
import type { Tracker } from './suggest';

const NAME = 'Avery Quinn';
const OTHER = 'Jordan Lee';

/** A tracker with its own records, and IDs that count up. */
function testTracker(author = NAME) {
  const records = new Map<string, SuggestionJson>();
  let next = 0;
  const tracker: Tracker & { records: typeof records; who: string } = {
    records,
    who: author,
    author: () => tracker.who,
    newId: () => `01m3sbsgg0000000000000s${String(++next).padStart(3, '0')}`,
    now: () => '2026-11-07T09:00:00.000Z',
    authorOf: (id) => records.get(id)?.author ?? null,
    stage: (id, record) => void records.set(id, record),
  };
  return tracker;
}

/** A state over marked Markdown with suggesting mode on. */
function suggestingState(source: string, tracker: Tracker) {
  const { state } = marked(source);
  return EditorState.create({
    doc: state.doc,
    selection: state.selection,
    plugins: [suggestingPlugin(() => true, tracker)],
  });
}

/** Types text one character per transaction, as keystrokes do. */
function type(state: EditorState, text: string): EditorState {
  let now = state;
  for (const char of text) now = now.apply(now.tr.insertText(char));
  return now;
}

/** Backspace: deletes the character before the caret. */
function backspace(state: EditorState): EditorState {
  const at = state.selection.from;
  return state.apply(state.tr.delete(at - 1, at));
}

function run(state: EditorState, tr: Transaction | null): EditorState {
  expect(tr).not.toBeNull();
  return state.apply(tr!);
}

describe('suggesting mode', () => {
  it("typing 'abc' makes one insertion with the person's name; Accept all leaves 'abc'; Reject all removes it", () => {
    const tracker = testTracker();
    const state = type(suggestingState('Say []', tracker), 'abc');
    const changes = changeRanges(state.doc);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'ins', text: 'abc' });
    expect(tracker.records.get(changes[0].id)).toEqual({ kind: 'ins', author: NAME, time: '2026-11-07T09:00:00.000Z' });
    expect(markdownOf(state)).toBe(`Say <span data-ins="${changes[0].id}">abc</span>`);
    expect(markdownOf(run(state, decide(state, pick(state.doc), 'accept')))).toBe('Say abc');
    expect(markdownOf(run(state, decide(state, pick(state.doc), 'reject')))).toBe('Say&#32;');
  });

  it("deleting 'xyz' keeps it as a deletion mark; Accept removes it, and Reject keeps the text", () => {
    const tracker = testTracker();
    let state = suggestingState('Keep xyz[] here', tracker);
    for (let i = 0; i < 3; i++) state = backspace(state);
    const changes = changeRanges(state.doc);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'del', text: 'xyz' });
    expect(tracker.records.get(changes[0].id)?.kind).toBe('del');
    expect(markdownOf(state)).toBe(`Keep <span data-del="${changes[0].id}">xyz</span> here`);
    // Backspace leaves the caret before the text it deleted.
    expect(state.selection.from).toBe(changes[0].from);
    expect(markdownOf(run(state, decide(state, pick(state.doc), 'accept')))).toBe('Keep  here');
    expect(markdownOf(run(state, decide(state, pick(state.doc), 'reject')))).toBe('Keep xyz here');
  });

  it('a typed replacement of a selection is a deletion and an insertion', () => {
    const tracker = testTracker();
    const state = type(suggestingState('A [cat] sat', tracker), 'dog');
    expect(changeRanges(state.doc).map((change) => [change.kind, change.text])).toEqual([
      ['del', 'cat'],
      ['ins', 'dog'],
    ]);
    expect(markdownOf(run(state, decide(state, pick(state.doc), 'accept')))).toBe('A dog sat');
    expect(markdownOf(run(state, decide(state, pick(state.doc), 'reject')))).toBe('A cat sat');
  });

  it('deleting text one typed as a suggestion removes it without a deletion mark', () => {
    const tracker = testTracker();
    let state = type(suggestingState('Hi []', tracker), 'ab');
    state = backspace(backspace(state));
    expect(markdownOf(state)).toBe('Hi&#32;');
    expect(changeRanges(state.doc)).toEqual([]);
  });

  it("another author's typing next to an insertion makes a second suggestion", () => {
    const tracker = testTracker();
    let state = type(suggestingState('Go []', tracker), 'ab');
    tracker.who = OTHER;
    state = type(state, 'cd');
    const changes = changeRanges(state.doc);
    expect(changes.map((change) => tracker.records.get(change.id)?.author)).toEqual([NAME, OTHER]);
    const byOther = pick(state.doc, { author: OTHER, authorOf: tracker.authorOf });
    expect(byOther.map((change) => change.text)).toEqual(['cd']);
    expect(markdownOf(run(state, decide(state, byOther, 'reject')))).toBe(
      `Go <span data-ins="${changes[0].id}">ab</span>`,
    );
  });

  it('a formatting command makes a format change; Reject puts the old Markdown back', () => {
    const tracker = testTracker();
    const state = suggestingState('Make [this] bold', tracker);
    const bold = state.schema.marks.bold.create();
    const after = state.apply(state.tr.addMark(state.selection.from, state.selection.to, bold));
    const [change] = changeRanges(after.doc);
    expect(change).toMatchObject({ kind: 'fmt', text: 'this' });
    expect(tracker.records.get(change.id)).toMatchObject({ kind: 'fmt', author: NAME, before: 'this' });
    const beforeOf = (id: string) => tracker.records.get(id)?.before;
    expect(markdownOf(run(after, decide(after, [change], 'accept', beforeOf)))).toBe('Make **this** bold');
    expect(markdownOf(run(after, decide(after, [change], 'reject', beforeOf)))).toBe('Make this bold');
  });

  it('edits with suggesting mode off stay plain', () => {
    const { state } = marked('Plain []');
    const plain = EditorState.create({
      doc: state.doc,
      selection: state.selection,
      plugins: [suggestingPlugin(() => false, testTracker())],
    });
    expect(markdownOf(type(plain, 'abc'))).toBe('Plain abc');
  });

  it('Next change moves through the suggestions in order', () => {
    const tracker = testTracker();
    let state = type(suggestingState('One [] two', tracker), 'x');
    state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)));
    state = type(state, 'y');
    state = state.apply(state.tr.setSelection(TextSelection.atStart(state.doc)));
    const first = nextChange(state, 1);
    expect(first?.text).toBe('x');
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, first!.from, first!.to)));
    expect(nextChange(state, 1)?.text).toBe('y');
    expect(nextChange(state, -1)).toBeNull();
  });
});

describe('the suggestion at the caret', () => {
  it('names the kind and the author, for a screen reader', () => {
    setReviewPrefs({ author: NAME });
    const state = type(suggestingState('Hi []', testTracker()), 'yo');
    const inside = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 5)));
    // The tracker's records are its own, so the page models do not know this author.
    expect(suggestionAtCaret(inside)?.text).toBe('Insertion by an unknown author');
    expect(suggestionAtCaret(state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1))))).toBeNull();
  });
});

describe('suggesting mode in an editor', () => {
  let test: TestEditor | null = null;
  beforeEach(() => {
    setReviewPrefs({ author: NAME });
    suggesting.set(true);
  });
  afterEach(() => {
    suggesting.set(false);
    test?.destroy();
    test = null;
  });

  it("typing in a mounted editor stages one record with the person's name", () => {
    test = mountEditor('Note []');
    typeInto(test.editor, 'abc');
    const [change] = changeRanges(test.editor.state.doc);
    expect(change).toMatchObject({ kind: 'ins', text: 'abc' });
    expect(findSuggestion(change.id)).toMatchObject({ kind: 'ins', author: NAME });
  });
});
