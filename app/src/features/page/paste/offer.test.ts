// @vitest-environment jsdom
// checks-disable-file brand-consistency: colors and sizes here are test inputs or CSS for other apps, not design values.
// Paste Options (ADR 0084): switching the choice after a paste is one transaction and one undo step, and an edit
// since the paste ends the chip.
import type { Editor } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Step } from '@tiptap/pm/transform';
import { afterEach, describe, expect, it } from 'vitest';
import { testHost } from '../../../editor/commands/testing';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { parseTextBlock } from '../../../editor/markdown/parse';
import { offerHolds, offerPasteOptions, switchChoice } from './offer';
import type { PasteOffer } from './offer';
import { sanitizePaste } from './sanitize';
import type { PasteChoice } from './types';

const html = `<p style="text-align:center"><span style="font-size:10.5pt;font-family:Georgia">Pasted words</span></p>
  <!--Word--><meta name="ProgId" content="Word.Document">`;

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.replaceChildren();
});

const rebuild = (choice: PasteChoice): PMNode | null => {
  const piece = sanitizePaste({ html, text: 'Pasted words' }, { fidelity: true, mode: choice }).pieces[0];
  return piece.kind === 'text' ? piece.doc : null;
};

function pasted(settled: string[]): PasteOffer {
  const root = document.body.appendChild(document.createElement('div'));
  editor = createBlockEditor(root, parseTextBlock('Before after'), { kind: 'text', block: 'b1', host: testHost() });
  const doc = rebuild('keepSource')!;
  const at = 8;
  editor.view.dispatch(
    editor.state.tr.insert(at, editor.schema.nodeFromJSON(doc.toJSON()).content.firstChild!.content),
  );
  const to = at + doc.firstChild!.content.size;
  return {
    editor,
    from: at,
    to,
    choice: 'keepSource',
    rebuild,
    settle: async () => void settled.push('command'),
  };
}

describe('switching Paste Options', () => {
  it('replaces the pasted text in one transaction and settles one undo step', async () => {
    const settled: string[] = [];
    const offer = pasted(settled);
    offerPasteOptions(offer);
    let changes = 0;
    editor!.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) changes += 1;
    });
    const next = await switchChoice(offer, 'mergeFormatting');
    expect(changes).toBe(1);
    expect(settled).toEqual(['command']);
    expect(next?.choice).toBe('mergeFormatting');
    expect(editor!.state.doc.textContent).toBe('Before Pasted wordsafter');
    expect(editor!.getJSON().content?.[0].content?.some((run) => run.marks)).toBe(false);
  });

  it('can switch again, and to text only', async () => {
    const offer = pasted([]);
    offerPasteOptions(offer);
    const merged = await switchChoice(offer, 'mergeFormatting');
    const text = await switchChoice(merged!, 'textOnly');
    expect(text?.choice).toBe('textOnly');
    expect(editor!.state.doc.textContent).toContain('Pasted words');
  });

  it('does nothing once the page has changed since the paste', async () => {
    const offer = pasted([]);
    offerPasteOptions(offer);
    editor!.view.dispatch(editor!.state.tr.insertText('x', 1));
    expect(offerHolds(offer)).toBe(false);
    expect(await switchChoice(offer, 'mergeFormatting')).toBeNull();
  });
});

describe('undoing a switch', () => {
  it('is one transaction whose inverse restores the previous choice and keeps the paste', async () => {
    // The page's undo replays the inverse of each step (the editor itself holds no history here).
    const offer = pasted([]);
    offerPasteOptions(offer);
    const before = editor!.state.doc;
    const steps: { step: Step; doc: PMNode }[] = [];
    editor!.on('transaction', ({ transaction }) => {
      transaction.steps.forEach((step, i) => steps.push({ step, doc: transaction.docs[i] }));
    });
    expect(await switchChoice(offer, 'mergeFormatting')).not.toBeNull();
    expect(editor!.state.doc.eq(before)).toBe(false);
    const undo = editor!.state.tr;
    for (const { step, doc } of steps.reverse()) undo.step(step.invert(doc));
    editor!.view.dispatch(undo);
    expect(editor!.state.doc.eq(before)).toBe(true);
    expect(editor!.state.doc.textContent).toContain('Pasted words');
  });

  it('switches a paste of several paragraphs', async () => {
    const root = document.body.appendChild(document.createElement('div'));
    editor = createBlockEditor(root, parseTextBlock('Before after'), { kind: 'text', block: 'b1', host: testHost() });
    const two = `<p>One</p><p style="text-align:center">Two</p><!--Word--><meta name="ProgId" content="Word.Document">`;
    const build = (choice: PasteChoice): PMNode | null => {
      const piece = sanitizePaste({ html: two, text: 'One\nTwo' }, { fidelity: true, mode: choice }).pieces[0];
      return piece.kind === 'text' ? piece.doc : null;
    };
    const doc = build('keepSource')!;
    const content = editor.schema.nodeFromJSON(doc.toJSON()).content;
    editor.view.dispatch(editor.state.tr.replace(8, 8, Slice.maxOpen(content)));
    const offer: PasteOffer = {
      editor,
      from: 8,
      to: 8 + content.size,
      choice: 'keepSource',
      rebuild: build,
      settle: async () => undefined,
    };
    offerPasteOptions(offer);
    const next = await switchChoice(offer, 'textOnly');
    expect(next?.choice).toBe('textOnly');
    expect(editor.state.doc.textContent).toContain('One');
    expect(editor.state.doc.textContent).toContain('Two');
  });
});
