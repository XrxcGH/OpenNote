// @vitest-environment jsdom
// The style commands in a real editor (text DESIGN.md 4.3). Applying a style sets the element's style, which the
// block saves in data.styles. Heading styles keep headings real headings. Update style to match selection and new
// style from selection store only what differs from the inherited look.
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { testHost } from '../../../editor/commands/testing';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { applyElementData, extractElementData } from '../../../editor/markdown/elements';
import { parseTextBlock } from '../../../editor/markdown/parse';
import { serializeTextBlock } from '../../../editor/markdown/serialize';
import {
  applyStyle,
  createdFromSelection,
  dialogStyle,
  selectionLook,
  styleOfNode,
  updatedToMatch,
  withHidden,
  withMoved,
  withoutStyle,
} from './commands';
// Importing the decorations registers them in every text editor whose host has text.styles2 on.
import { STYLE_DECORATIONS } from './decorations';
import type { StyleContext } from './resolve';
import { APP_STYLES } from './sets';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.replaceChildren();
});

function mount(markdown: string, ids: string[]): Editor {
  const root = document.body.appendChild(document.createElement('div'));
  const doc = applyElementData(parseTextBlock(markdown), { ids });
  editor = createBlockEditor(root, doc, { kind: 'text', block: 'b1', host: testHost() });
  return editor;
}

function caret(target: Editor, pos: number): void {
  target.view.dispatch(target.state.tr.setSelection(TextSelection.create(target.state.doc, pos)));
}

const saved = (target: Editor) => extractElementData(target.state.doc, () => 'new');

describe('applying a style', () => {
  it('makes a paragraph a heading for a heading style, so it stays a real heading', () => {
    const e = mount('one\n\ntwo', ['a', 'b']);
    caret(e, 2);
    expect(applyStyle(e, 'h2', APP_STYLES)).toBe(true);
    expect(e.state.doc.child(0).type.name).toBe('heading');
    expect(e.state.doc.child(0).attrs.level).toBe(2);
    expect(serializeTextBlock(e.state.doc)).toBe('## one\n\ntwo');
    expect(styleOfNode(e.state.doc.child(0))).toBe('h2');
  });

  it('sets data.styles for the other styles, and a heading turned into one becomes a paragraph', () => {
    const e = mount('# one\n\ntwo', ['a', 'b']);
    caret(e, 2);
    applyStyle(e, 'u-lab', { 'u-lab': { label: 'Lab' } });
    expect(e.state.doc.child(0).type.name).toBe('paragraph');
    expect(saved(e).data.styles).toEqual({ a: 'u-lab' });
    expect(e.view.dom.querySelector('[data-pstyle="u-lab"]')?.textContent).toBe('one');
    applyStyle(e, 'normal', APP_STYLES);
    expect(saved(e).data.styles).toEqual({});
    expect(STYLE_DECORATIONS.getState(e.state)?.find().length).toBe(0);
  });

  it('writes Title, Subtitle, Quote, Intense Quote, and Citation as styles of paragraphs', () => {
    const e = mount('one', ['a']);
    for (const name of ['title', 'subtitle', 'quote', 'quote2', 'citation']) {
      caret(e, 2);
      applyStyle(e, name, APP_STYLES);
      expect(saved(e).data.styles).toEqual({ a: name });
    }
  });

  it('makes headings 7 to 9 paragraphs with an outline level (SPEC R-STY-3), and drops it again', () => {
    const e = mount('one', ['a']);
    caret(e, 2);
    applyStyle(e, 'h8', APP_STYLES);
    expect(saved(e).data).toMatchObject({ styles: { a: 'h8' }, paras: { a: { outline: 8 } } });
    applyStyle(e, 'quote', APP_STYLES);
    expect(saved(e).data.paras).toEqual({});
  });

  it('keeps a heading a real heading for a user style based on a heading style', () => {
    const e = mount('# one\n\ntwo', ['a', 'b']);
    caret(e, 2);
    const sheet = { ...APP_STYLES, 'u-sub': { label: 'Sub', basedOn: 'h1' }, 'u-deep': { basedOn: 'u-sub' } };
    applyStyle(e, 'u-sub', sheet);
    expect(e.state.doc.child(0).type.name).toBe('heading');
    expect(e.state.doc.child(0).attrs.level).toBe(1);
    expect(serializeTextBlock(e.state.doc)).toBe('# one\n\ntwo');
    expect(saved(e).data.styles).toEqual({ a: 'u-sub' });
    expect(styleOfNode(e.state.doc.child(0))).toBe('u-sub');
    // Two steps down the chain, on a plain paragraph, still gives the heading's level.
    caret(e, e.state.doc.child(0).nodeSize + 2);
    applyStyle(e, 'u-deep', sheet);
    expect(e.state.doc.child(1).type.name).toBe('heading');
    expect(saved(e).data.styles).toEqual({ a: 'u-sub', b: 'u-deep' });
    applyStyle(e, 'normal', sheet);
    expect(e.state.doc.child(1).type.name).toBe('paragraph');
    expect(saved(e).data.styles).toEqual({ a: 'u-sub' });
  });

  it('applies a character style as the charStyle mark', () => {
    const e = mount('one two', ['a']);
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 1, 4)));
    applyStyle(e, 'u-key', { 'u-key': { type: 'character', weight: 700 } });
    expect(serializeTextBlock(e.state.doc)).toBe('<span data-style="u-key">one</span> two');
  });
});

const ctx = (notebook: StyleContext['notebook']): StyleContext => ({ app: APP_STYLES, notebook });

describe('changing styles from the selection', () => {
  it('update style to match selection stores only values that differ from the inherited ones', () => {
    const e = mount('**one**', ['a']);
    caret(e, 2);
    const c = ctx({ normal: { font: 'Georgia', future: 'kept' }, h1: {} });
    const { style, look } = selectionLook(e, c);
    expect(style).toBe('normal');
    // The selection is bold Georgia; normal inherits Georgia already, so only the weight is new.
    expect(updatedToMatch(c, style, look).normal).toEqual({ font: 'Georgia', future: 'kept', weight: 700 });
  });

  it('new style from selection is based on the selection style and holds only the difference', () => {
    const e = mount('*one*', ['a']);
    caret(e, 2);
    const c = ctx({});
    const { style, look } = selectionLook(e, c);
    const made = createdFromSelection(c, 'Aside', style, look);
    expect(made.name).toBe('u-aside');
    expect(made.styles['u-aside']).toEqual({ label: 'Aside', basedOn: 'normal', italic: true });
  });

  it('gives a second new style a numbered label and name', () => {
    const first = createdFromSelection(ctx({}), 'New style', 'normal', { italic: true });
    const second = createdFromSelection(ctx(first.styles), 'New style', 'normal', { italic: true });
    expect(second.label).toBe('New style 2');
    expect(second.name).toBe('u-new-style-2');
    expect(second.styles['u-new-style-2']).toMatchObject({ label: 'New style 2' });
    expect(second.styles['u-new-style']).toMatchObject({ label: 'New style' });
  });

  it('never writes a style name outside R-STY-3, whatever name the element carries', () => {
    const c = ctx({ normal: { italic: true } });
    for (const bad of ['Bad Name', 'x</style>', '__proto__', 'u-']) {
      expect(updatedToMatch(c, bad, { weight: 700 })).toBe(c.notebook);
      expect(Object.keys(updatedToMatch(c, bad, { weight: 700 }))).toEqual(['normal']);
      expect(withHidden(c.notebook, bad, true)).toBe(c.notebook);
      expect(withMoved(c.notebook, [bad, 'h1'], bad, 1)).toBe(c.notebook);
      expect(createdFromSelection(c, 'Mine', bad, {}).styles['u-mine']).toMatchObject({ basedOn: 'normal' });
    }
  });

  it('opens Modify style only on the styles its dialog can edit', () => {
    expect(dialogStyle('h1')).toBe('h1');
    expect(dialogStyle('code')).toBe('code');
    for (const name of ['subtitle', 'citation', 'quote2', 'h7', 'u-memo']) expect(dialogStyle(name)).toBeNull();
  });

  it('deletes only user styles, hides, and reorders the gallery', () => {
    expect(withoutStyle({ 'u-a': {} }, 'u-a')).toEqual({});
    expect(withoutStyle({ h1: {} }, 'h1')).toBeNull();
    expect(withHidden({}, 'quote2', true)).toEqual({ quote2: { hidden: true } });
    expect(withHidden({ quote2: { hidden: true } }, 'quote2', false)).toEqual({ quote2: {} });
    expect(withMoved({}, ['h1', 'h2', 'h3'], 'h3', -1)).toEqual({
      h1: { order: 0 },
      h3: { order: 1 },
      h2: { order: 2 },
    });
  });
});
