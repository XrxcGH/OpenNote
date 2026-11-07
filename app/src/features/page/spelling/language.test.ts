// @vitest-environment jsdom

// Spell check by language (lane text:language-direction). Each part of a textblock goes to the checker in its own
// language. Text set to "do not check spelling" (zxx) never leaves the page. The fake client records each call.
import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { testHost } from '../../../editor/commands/testing';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { textblockText } from '../../../editor/extensions/spellingText';
import { parseTextBlock } from '../../../editor/markdown/parse';
import type { SpellingClient } from '../../../platform/types';
import { createSpellingEngine } from './engine';
import type { SpellItem, SpellingRules } from './engine';
import { piecesOf, resolveLanguage } from './languages';

const RULES: SpellingRules = {
  enabled: true,
  languages: ['en-US'],
  personalWords: [],
  ignoreUppercase: true,
  ignoreWithDigits: true,
};

/** Each language knows its misspelled words; every call is recorded. */
const BAD: Record<string, readonly string[]> = { 'en-US': ['teh'], 'fr-FR': ['chatt'] };

function fakeClient(installed = ['en-US', 'fr-FR']) {
  const calls: { texts: string[]; languages: readonly string[] }[] = [];
  const client: SpellingClient = {
    languages: () => Promise.resolve(installed.map((tag, i) => ({ tag, name: tag, isDefault: i === 0 }))),
    check: (items, languages) => {
      calls.push({ texts: items.map((item) => item.text), languages: [...languages] });
      const bad = languages.flatMap((language) => BAD[language] ?? []);
      return Promise.resolve(
        items.map(({ id, text }) => ({
          id,
          errors: [...text.matchAll(/\S+/g)]
            .filter((match) => bad.includes(match[0]))
            .map((match) => ({ start: match.index, length: match[0].length })),
        })),
      );
    },
    suggest: () => Promise.resolve([]),
    addWord: () => Promise.resolve(),
    removeWord: () => Promise.resolve(),
  };
  return { client, calls };
}

const idleNow = { typingDelayMs: 0, idle: (run: () => void) => setTimeout(run, 0) };
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

function paragraph(html: string, attrs: Record<string, string> = {}): HTMLElement {
  const element = document.createElement('p');
  Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

const itemOf = (element: Element): SpellItem => {
  const { text, langs } = textblockText(element);
  return langs ? { text, langs } : { text };
};

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.replaceChildren();
});

describe('spell check by language', () => {
  it('sends a French run to the engine with fr-FR, and the rest with the page language', async () => {
    const { client, calls } = fakeClient();
    const engine = createSpellingEngine(client, RULES, idleNow);
    const item = itemOf(paragraph('I saw teh <span lang="fr-FR">chatt noir</span> today'));
    expect(item.langs).toEqual([{ start: 10, length: 10, lang: 'fr-FR' }]);
    engine.check([item], 'now');
    await settle();
    expect(calls).toContainEqual({ texts: ['chatt noir'], languages: ['fr-FR'] });
    expect(calls).toContainEqual({ texts: ['I saw teh            today'], languages: ['en-US'] });
    // Errors from both requests map back to the textblock's offsets.
    expect(engine.errorsFor(item.text, item.langs)).toEqual([
      { start: 6, length: 3 },
      { start: 10, length: 5 },
    ]);
  });

  it('never sends a zxx run', async () => {
    const { client, calls } = fakeClient();
    const engine = createSpellingEngine(client, RULES, idleNow);
    const item = itemOf(paragraph('see <span lang="zxx">teh xyzzy</span> now'));
    engine.check([item], 'now');
    await settle();
    const sent = calls.flatMap((call) => call.texts).join('|');
    expect(sent).not.toContain('teh');
    expect(sent).not.toContain('xyzzy');
    expect(engine.errorsFor(item.text, item.langs)).toEqual([]);
  });

  it('checks a paragraph in its own language, and never sends a zxx paragraph', async () => {
    const { client, calls } = fakeClient();
    const engine = createSpellingEngine(client, RULES, idleNow);
    const french = itemOf(paragraph('le chatt', { lang: 'fr-FR' }));
    const none = itemOf(paragraph('teh teh', { lang: 'zxx' }));
    engine.check([french, none], 'now');
    await settle();
    expect(calls).toEqual([{ texts: ['le chatt'], languages: ['fr-FR'] }]);
    expect(engine.errorsFor(none.text, none.langs)).toEqual([]);
  });

  it('reads a list item paragraph language from its list item', () => {
    const li = document.body.appendChild(document.createElement('li'));
    li.setAttribute('lang', 'fr-FR');
    const p = li.appendChild(document.createElement('p'));
    p.textContent = 'bonjour';
    expect(textblockText(p).langs).toEqual([{ start: 0, length: 7, lang: 'fr-FR' }]);
  });

  it('leaves a part unchecked when no installed checker knows its language', async () => {
    const { client, calls } = fakeClient();
    const engine = createSpellingEngine(client, RULES, idleNow);
    const item = itemOf(paragraph('ok <span lang="de-DE">Haus</span>'));
    engine.check([item], 'now');
    await settle();
    expect(calls).toEqual([{ texts: ['ok     '], languages: ['en-US'] }]);
    expect(engine.errorsFor(item.text, item.langs)).toEqual([]);
  });

  it('asks again when the same text gets another language', async () => {
    const { client, calls } = fakeClient();
    const engine = createSpellingEngine(client, RULES, idleNow);
    engine.check(['chatt'], 'now');
    await settle();
    expect(engine.errorsFor('chatt')).toEqual([]);
    expect(engine.errorsFor('chatt', [{ start: 0, length: 5, lang: 'fr-FR' }])).toBeNull();
    engine.check([{ text: 'chatt', langs: [{ start: 0, length: 5, lang: 'fr-FR' }] }], 'now');
    await settle();
    expect(engine.errorsFor('chatt', [{ start: 0, length: 5, lang: 'fr-FR' }])).toEqual([{ start: 0, length: 5 }]);
    expect(calls.map((call) => call.languages)).toEqual([['en-US'], ['fr-FR']]);
  });

  it('suggests in the word language', async () => {
    const asked: (readonly string[])[] = [];
    const { client } = fakeClient();
    const engine = createSpellingEngine(
      { ...client, suggest: (_word, languages) => (asked.push(languages), Promise.resolve([])) },
      RULES,
      idleNow,
    );
    await engine.suggest('chatt', 'fr');
    await engine.suggest('teh');
    expect(asked).toEqual([['fr-FR'], ['en-US']]);
  });

  it('a mounted editor asks for its lang runs with their language', async () => {
    const requests: { text: string; langs?: readonly unknown[] }[] = [];
    const host = testHost({
      spelling: () => ({
        errorsFor: () => null,
        requestCheck: (_key, text, langs) => void requests.push({ text, langs }),
      }),
    });
    host.editing = { ...host.editing, spelling: { ...host.editing.spelling, enabled: true } };
    const root = document.body.appendChild(document.createElement('div'));
    const doc = parseTextBlock('a <span lang="fr-FR">chat</span> b <span lang="zxx">xq</span>');
    editor = createBlockEditor(root, doc, { kind: 'text', block: 'b1', host });
    await settle();
    expect(requests).toContainEqual({ text: 'a chat b   ', langs: [{ start: 2, length: 4, lang: 'fr-FR' }] });
  });
});

describe('language pieces and checkers', () => {
  it('blanks own-language parts of the page piece and keeps offsets', () => {
    expect(piecesOf({ text: 'ab cd ef', langs: [{ start: 3, length: 2, lang: 'fr' }] }, 4)).toEqual([
      { item: 4, offset: 0, text: 'ab    ef', lang: null },
      { item: 4, offset: 3, text: 'cd', lang: 'fr' },
    ]);
    expect(piecesOf({ text: 'cd', langs: [{ start: 0, length: 2, lang: 'fr' }] }, 0)).toEqual([
      { item: 0, offset: 0, text: 'cd', lang: 'fr' },
    ]);
  });

  it('matches a tag exactly, then by primary language, else not at all', () => {
    const installed = [{ tag: 'en-US' }, { tag: 'fr-CA' }, { tag: 'fr-FR', isDefault: true }];
    expect(resolveLanguage('FR-ca', installed)).toBe('fr-CA');
    expect(resolveLanguage('fr', installed)).toBe('fr-FR');
    expect(resolveLanguage('fr-BE', installed)).toBe('fr-FR');
    expect(resolveLanguage('de-DE', installed)).toBeNull();
  });
});
