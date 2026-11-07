// Set language and "Do not check spelling" (lane text:language-direction). A selection gets a lang run in the
// file's tag form (text SPEC D.8), and a caret alone sets its paragraph's language.
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { applyTo, marked } from '../../../editor/commands/testing';
import { canonicalTag, languageChoices, selectionLanguage, setLanguage, toggleNoProof } from './setLanguage';

const run = (state: EditorState, command: (s: EditorState, d: (tr: Transaction) => void) => boolean) => {
  let next = state;
  command(state, (tr) => void (next = state.apply(tr)));
  return next;
};

describe('set language', () => {
  it('marks the selected text with the language, in the tag form the file keeps', () => {
    expect(applyTo('a [chat] b', (s, d) => setLanguage(s, d, 'fr_fr'))).toBe('a <span lang="fr-FR">chat</span> b');
  });

  it('returns selected text to the page language', () => {
    expect(applyTo('a [<span lang="fr-FR">chat</span>] b', (s, d) => setLanguage(s, d, null))).toBe('a chat b');
  });

  it('sets the paragraph language when nothing is selected', () => {
    const { state } = marked('bonjour');
    const next = run(state, (s, d) => setLanguage(s, d, 'fr-CA'));
    expect(next.doc.firstChild?.attrs.lang).toBe('fr-CA');
    expect(selectionLanguage(next)).toBe('fr-CA');
  });

  it('refuses a value that is not a language tag', () => {
    const { state } = marked('a [b] c');
    expect(setLanguage(state, undefined, 'English')).toBe(false);
  });

  it('turns do not check spelling on and off', () => {
    const { state } = marked('a [teh] b');
    const on = run(state, toggleNoProof);
    expect(selectionLanguage(on)).toBe('zxx');
    const off = run(on, toggleNoProof);
    expect(selectionLanguage(off)).toBeNull();
  });
});

describe('language tags and choices', () => {
  it('shapes tags as BCP 47 writes them', () => {
    expect(canonicalTag('EN_us')).toBe('en-US');
    expect(canonicalTag('zh-hant-tw')).toBe('zh-Hant-TW');
    expect(canonicalTag('es-419')).toBe('es-419');
    expect(canonicalTag('english')).toBeNull();
  });

  it('lists each language once, sorted by its American English name', () => {
    // American English, French (France), German (Germany), and Mexican Spanish or Spanish (Mexico).
    expect(languageChoices(['en-US'], ['fr-FR', 'EN-us', 'de-DE'], 'es-MX')).toEqual([
      'en-US',
      'fr-FR',
      'de-DE',
      'es-MX',
    ]);
    expect(languageChoices([], [], 'zxx')).toEqual([]);
  });
});
