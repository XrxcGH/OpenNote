import { describe, expect, it } from 'vitest';
import { BATCH, packFor, sizeLabel, translateMarkdown, translationEngine, useTranslationEngine } from './engine';
import type { LanguagePack, TranslationEngine } from './engine';
import { assemble, hasWords, plan, restore, splitLine } from './segment';

/** Reverses the words of each line, so a translation is visible and the placeholders must survive it. */
const reversing = (calls: string[][] = []): TranslationEngine => ({
  name: 'reversing',
  packs: () => Promise.resolve([]),
  installed: () => Promise.resolve(new Set<string>()),
  install: () => Promise.resolve(),
  remove: () => Promise.resolve(),
  translate(lines) {
    calls.push([...lines]);
    return Promise.resolve(lines.map((line) => line.split(' ').reverse().join(' ')));
  },
});

describe('keeping formatting', () => {
  it('splits a line into its lead, its words, and what must not change', () => {
    const line = splitLine('- [ ] Buy **fresh** bread with `cash`');
    expect(line.lead).toBe('- [ ] ');
    expect(line.held).toEqual(['`cash`', '**', '**']);
    expect(line.text).toBe('Buy ⟦1⟧fresh⟦2⟧ bread with ⟦0⟧');
  });

  it('holds the address of a link and a picture, and translates the link text', () => {
    const line = splitLine('See [the shop](https://example.org/x) now');
    expect(line.text).toBe('See [the shop⟦0⟧ now');
    expect(line.held).toEqual(['](https://example.org/x)']);
  });

  it('puts everything back after a translation that keeps the placeholders', () => {
    const line = splitLine('## Hello **big** world');
    expect(restore(line, 'Mundo ⟦0⟧grande⟦1⟧ hola')).toBe('## Mundo **grande** hola');
  });

  it('refuses a translation that lost or invented a placeholder', () => {
    const line = splitLine('Hello **big** world');
    expect(restore(line, 'Mundo grande hola')).toBeNull();
    expect(restore(line, 'Mundo ⟦0⟧grande⟦1⟧ ⟦2⟧')).toBeNull();
  });

  it('sends only lines that have words, and leaves code fences and numbers alone', () => {
    const planned = plan('Title\n\n```\ncode here\n```\n42\n$x^2$\nLast line');
    expect(planned.send).toEqual([0, 7]);
    expect(hasWords(splitLine('3.14 `x`'))).toBe(false);
  });

  it('keeps the original line when the engine spoiled it', () => {
    const markdown = 'Keep **this** line\nPlain words';
    const planned = plan(markdown);
    const out = assemble(markdown, planned, ['no placeholders here', 'Palabras simples']);
    expect(out).toEqual({ text: 'Keep **this** line\nPalabras simples', kept: 1 });
  });
});

describe('translating a document', () => {
  it('translates the lines with words in steps and reports progress', async () => {
    const calls: string[][] = [];
    const lines = Array.from({ length: BATCH + 5 }, (_, i) => `one two ${i}`).join('\n');
    const progress: number[] = [];
    const done = await translateMarkdown(lines, reversing(calls), 'en', 'es', { onProgress: (f) => progress.push(f) });
    expect(calls.map((batch) => batch.length)).toEqual([BATCH, 5]);
    expect(done.text.split('\n')[0]).toBe('0 two one');
    expect(progress.at(-1)).toBe(1);
  });

  it('keeps bold marks through a translation that moves the words', async () => {
    const done = await translateMarkdown('# One **two** three', reversing(), 'en', 'es');
    expect(done.text).toBe('# three **two** One');
  });

  it('stops when asked, between steps', async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(translateMarkdown('a b', reversing(), null, 'es', { signal: stop.signal })).rejects.toThrow();
  });

  it('refuses an engine that answers with the wrong number of lines', async () => {
    const broken: TranslationEngine = { ...reversing(), translate: () => Promise.resolve([]) };
    await expect(translateMarkdown('hello there', broken, 'en', 'es')).rejects.toThrow('wrong number');
  });

  it('has no engine until a build installs one', () => {
    expect(translationEngine()).toBeNull();
    const remove = useTranslationEngine(reversing());
    expect(translationEngine()?.name).toBe('reversing');
    remove();
    expect(translationEngine()).toBeNull();
  });
});

describe('language packs', () => {
  const packs: LanguagePack[] = [
    { id: 'en-es', from: 'en', to: 'es', name: 'English to Spanish', size: 65_000_000 },
    { id: 'es-en', from: 'es', to: 'en', name: 'Spanish to English', size: 63_000_000 },
  ];

  it('finds the pack for a pair, ignoring the region', () => {
    expect(packFor(packs, 'en-US', 'es-MX')?.id).toBe('en-es');
    expect(packFor(packs, 'es', 'en')?.id).toBe('es-en');
    expect(packFor(packs, 'fr', 'es')).toBeNull();
    expect(packFor(packs, null, 'en')?.id).toBe('es-en');
  });

  it('shows sizes plainly', () => {
    expect(sizeLabel(65_000_000)).toBe('62 MB');
    expect(sizeLabel(1_610_612_736)).toBe('1.5 GB');
    expect(sizeLabel(10)).toBe('1 MB');
  });
});
