// @vitest-environment jsdom
// The notes area with real editors (ADR 0087). It checks the roles and Enter on a selected reference. It checks what
// the note editor saves when it loses the focus, also with text over the 64 KiB limit (R-NOTE-1).
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlockEditor } from '../extensions/kit';
import { DEFAULT_EDITING_VIEW } from '../host';
import type { EditorHost } from '../host';
import { parseTextBlock } from '../markdown';
import { KEEP_PENDING, NotesModel } from './model';
import { noteMarks } from './refs';
import { MAX_NOTE_BYTES } from './noteText';
import { createNotesView } from './view';
import type { NotesView } from './view';

const host: EditorHost = {
  settings: () => DEFAULT_EDITING_VIEW,
  flag: () => true,
  announce: () => {},
  openMenu: () => Promise.resolve(null),
  screenReader: () => false,
  spelling: () => null,
  selectBlocks: () => {},
};

const ID = '01m3sbcmt0000000000000n001';
const views: NotesView[] = [];
const editors: Editor[] = [];

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
});

/** A page with one text block that refers to one footnote, and the notes area under it. */
function setup() {
  const world = document.body.appendChild(document.createElement('div'));
  const flow = world.appendChild(document.createElement('div'));
  const text = createBlockEditor(flow.appendChild(document.createElement('div')), parseTextBlock(`One[^${ID}]`), {
    kind: 'text',
    block: 'b1',
    host,
  });
  editors.push(text);
  const model = new NotesModel();
  model.setBlock('b1', { [ID]: { kind: 'foot', markdown: 'Note' } });
  const sent: unknown[] = [];
  const warn = vi.fn();
  const view = createNotesView({
    model,
    after: flow,
    root: world,
    host,
    readOnly: false,
    blocks: () => [{ id: 'b1', doc: text.state.doc }],
    sendNotes: (block, patch) => sent.push({ block, patch }),
    sendSettings: () => undefined,
    showRef: () => undefined,
    editorAt: (element) => (element.closest('[data-block="b1"]') ? text : null),
    warn,
  });
  views.push(view);
  /** The note's editor, once it is open. */
  const noteEditor = () =>
    (view.element.querySelector('[contenteditable]') as (HTMLElement & { editor?: Editor }) | null)?.editor ?? null;
  const blur = async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    noteEditor()?.emit('blur', { editor: noteEditor()!, event: new FocusEvent('blur'), transaction: null as never });
    await Promise.resolve();
  };
  return { view, text, model, sent, warn, noteEditor, blur };
}

describe('the notes area', () => {
  it('keeps list items as list items and shows one text box per note', () => {
    const { view, noteEditor } = setup();
    const li = view.element.querySelector('li')!;
    expect(li.getAttribute('role')).toBeNull();
    expect(li.firstElementChild!.getAttribute('role')).toBe('doc-footnote');
    expect(view.element.querySelectorAll('[role="textbox"]')).toHaveLength(1);

    view.focusNote(ID);
    expect(noteEditor()).not.toBeNull();
    const boxes = view.element.querySelectorAll('[role="textbox"]');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.getAttribute('contenteditable')).toBe('true');
    expect(boxes[0]!.getAttribute('aria-label')).toBe('Footnote 1');
    expect(view.element.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Footnote 1');
  });

  it('goes to the note on Enter when a reference is selected, and leaves the reference in place', () => {
    const { text, noteEditor } = setup();
    let at = -1;
    text.state.doc.descendants((node, pos) => {
      if (node.type.name === 'footnoteRef') at = pos;
    });
    text.view.dispatch(text.state.tr.setSelection(NodeSelection.create(text.state.doc, at)));
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    text.view.dom.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(noteEditor()).not.toBeNull();
    expect(noteMarks(text.state.doc)).toEqual([{ kind: 'ref', id: ID }]);
    expect(text.state.doc.childCount).toBe(1);
  });

  it('leaves Enter alone when no reference is selected', () => {
    const { text, noteEditor } = setup();
    text.commands.setTextSelection(2);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    text.view.dom.dispatchEvent(enter);
    expect(noteEditor()).toBeNull();
  });

  it('saves typed note text when the note editor loses the focus', async () => {
    const { view, sent, noteEditor, blur } = setup();
    view.focusNote(ID);
    noteEditor()!.commands.insertContentAt(noteEditor()!.state.doc.content.size - 1, ' more');
    await blur();
    expect(sent).toEqual([{ block: 'b1', patch: { [ID]: { kind: 'foot', markdown: 'Note more' } } }]);
    expect(noteEditor()).toBeNull();
    expect(view.element.querySelector('li')!.textContent).toBe('1Note more');
  });

  it('warns and keeps the editor open when the note is over 64 KiB', async () => {
    const { view, sent, warn, noteEditor, blur } = setup();
    view.focusNote(ID);
    noteEditor()!.commands.insertContentAt(1, 'x'.repeat(MAX_NOTE_BYTES));
    await blur();
    expect(sent).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('64 KB');
    // The typed text is still there to shorten.
    expect(noteEditor()).not.toBeNull();
    expect(noteEditor()!.state.doc.textContent.length).toBeGreaterThan(MAX_NOTE_BYTES);
    expect(view.element.querySelector('[aria-invalid="true"]')).not.toBeNull();

    // Shortened under the limit, it saves and closes.
    noteEditor()!.commands.setContent('<p>Short</p>');
    await blur();
    expect(sent).toEqual([{ block: 'b1', patch: { [ID]: { kind: 'foot', markdown: 'Short' } } }]);
    expect(noteEditor()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('note references and pending notes', () => {
  it('leaves out a reference whose ID is not an element ID', () => {
    const doc = parseTextBlock('One');
    const ref = doc.type.schema.nodes.footnoteRef!;
    const bad = doc.type.schema.nodes.paragraph!.create(null, [
      ref.create({ id: 'x"]{}*{content:"!"' }),
      ref.create({ id: ID }),
    ]);
    expect(noteMarks(doc.type.create(null, [bad]))).toEqual([{ kind: 'ref', id: ID }]);
  });

  it('keeps at most a set number of pending notes', () => {
    const model = new NotesModel();
    for (let n = 0; n <= KEEP_PENDING; n += 1) model.expect(`p${n}`, 'foot');
    const shown = model.shown('b1');
    expect(Object.keys(shown)).toHaveLength(KEEP_PENDING);
    expect(shown.p0).toBeUndefined();
    expect(shown[`p${KEEP_PENDING}`]).toBeDefined();
  });
});
