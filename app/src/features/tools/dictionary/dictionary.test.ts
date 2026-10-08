// The dictionary: cleaning a word, finding its base form, looking it up in the bundled English chunks, and reading a
// dictionary file for another language.
import { describe, expect, it } from 'vitest';
import { englishLoader } from './data';
import { chunkKey, cleanWord, lookupWord, synonymsOf } from './lookup';
import { baseForms } from './morphy';
import { MAX_PACK_BYTES, PACK_FORMAT, memoryPackStore, packLoader, readPackFile } from './packs';
import type { Chunk } from './types';

describe('cleanWord', () => {
  it('trims marks and spaces at the ends and lowercases', () => {
    expect(cleanWord('  “Analyze,” ')).toBe('analyze');
    expect(cleanWord('(Cause)')).toBe('cause');
    expect(cleanWord('Hello   World.')).toBe('hello world');
    expect(cleanWord('...')).toBe('');
    expect(cleanWord("don't")).toBe("don't");
  });

  it('puts a word in the chunk of its first letter', () => {
    expect(chunkKey('analyze')).toBe('a');
    expect(chunkKey('émigré')).toBe('e');
    expect(chunkKey('3d')).toBe('_');
  });
});

describe('base forms', () => {
  it('finds the base of regular endings', () => {
    expect(baseForms('analyzes')).toContain('analyze');
    expect(baseForms('studies')).toContain('study');
    expect(baseForms('boxes')).toContain('box');
    expect(baseForms('causing')).toContain('cause');
    expect(baseForms('caused')).toContain('cause');
    expect(baseForms('larger')).toContain('large');
  });

  it('undoubles a letter the ending doubled', () => {
    expect(baseForms('running')).toContain('run');
    expect(baseForms('stopped')).toContain('stop');
  });

  it('knows the words that do not follow the rules', () => {
    expect(baseForms('went')).toEqual(['go']);
    expect(baseForms('children')).toContain('child');
    expect(baseForms('better')).toContain('good');
  });

  it('never gives the word back, and leaves short words alone', () => {
    expect(baseForms('is')).not.toContain('is');
    expect(baseForms('as')).toEqual([]);
  });
});

describe('looking up English', () => {
  it('gives meanings by part of speech, each with synonyms and an example', async () => {
    const found = await lookupWord('Cause', englishLoader);
    expect(found?.word).toBe('cause');
    expect(found?.meanings.map((meaning) => meaning.pos)).toEqual(['n', 'v']);
    const noun = found?.meanings[0].senses[0];
    expect(noun?.definition).toMatch(/makes something happen/);
    expect(noun?.synonyms).toContain('reason');
    expect(noun?.example).toMatch(/flood/);
  });

  it('finds an inflected word by its base form and says so', async () => {
    const found = await lookupWord('analyzed', englishLoader);
    expect(found).toMatchObject({ query: 'analyzed', word: 'analyze' });
  });

  it('lists every synonym once, the word itself left out', async () => {
    const found = await lookupWord('create', englishLoader);
    expect(found?.synonyms).toEqual(expect.arrayContaining(['make', 'produce']));
    expect(found?.synonyms).not.toContain('create');
    expect(new Set(found?.synonyms).size).toBe(found?.synonyms.length);
  });

  it('tries the first word of a phrase that is not in the dictionary', async () => {
    expect((await lookupWord('cause and effect', englishLoader))?.word).toBe('cause');
  });

  it('is null for a word that is not there, an empty word, and a made-up chunk', async () => {
    expect(await lookupWord('zzyzx', englishLoader)).toBeNull();
    expect(await lookupWord('  ', englishLoader)).toBeNull();
    expect(await lookupWord('__proto__', englishLoader)).toBeNull();
    expect(await lookupWord('3d', englishLoader)).toBeNull();
  });
});

describe('synonymsOf', () => {
  it('keeps the order of the senses and drops repeats whatever their case', () => {
    const meanings = [
      { pos: 'v' as const, senses: [{ definition: 'x', synonyms: ['Make', 'build'], example: null }] },
      { pos: 'n' as const, senses: [{ definition: 'y', synonyms: ['make', 'brand', 'word'], example: null }] },
    ];
    expect(synonymsOf('word', meanings)).toEqual(['Make', 'build', 'brand']);
  });
});

describe('dictionary files for other languages', () => {
  const file = (extra: object = {}) =>
    JSON.stringify({
      format: PACK_FORMAT,
      name: 'Español',
      language: 'es',
      entries: { Casa: [['n', [['Edificio para vivir.', ['hogar', 'vivienda'], 'Vivo en una casa.']]]] },
      ...extra,
    });

  it('reads a good file and lowercases its words', () => {
    const read = readPackFile(file(), 'p1');
    expect('pack' in read && read.pack.info).toEqual({
      id: 'p1',
      name: 'Español',
      language: 'es',
      words: 1,
      bytes: file().length,
    });
  });

  it('refuses a file that is not JSON, not a dictionary, empty, badly made, or too large', () => {
    expect(readPackFile('nope', 'p')).toEqual({ problem: 'notJson' });
    expect(readPackFile(file({ format: 'other' }), 'p')).toEqual({ problem: 'format' });
    expect(readPackFile(file({ name: '  ' }), 'p')).toEqual({ problem: 'format' });
    expect(readPackFile(file({ entries: {} }), 'p')).toEqual({ problem: 'empty' });
    expect(readPackFile(file({ entries: { casa: [['x', []]] } }), 'p')).toEqual({ problem: 'format' });
    expect(readPackFile(file({ entries: { casa: [['n', [[1, [], null]]]] } }), 'p')).toEqual({ problem: 'format' });
    expect(readPackFile('x'.repeat(MAX_PACK_BYTES + 1), 'p')).toEqual({ problem: 'tooLarge' });
  });

  it('looks words up like the English ones do', async () => {
    const read = readPackFile(file(), 'p1');
    if (!('pack' in read)) throw new Error('not read');
    const found = await lookupWord('Casa', packLoader(read.pack));
    expect(found?.meanings[0].senses[0].synonyms).toEqual(['hogar', 'vivienda']);
    const chunk: Chunk | null = await packLoader(read.pack)('c');
    expect(Object.keys(chunk ?? {})).toEqual(['casa']);
  });

  it('is kept, listed, and removed by a store', async () => {
    const store = memoryPackStore();
    const read = readPackFile(file(), 'p1');
    if (!('pack' in read)) throw new Error('not read');
    await store.put(read.pack);
    expect((await store.list()).map((pack) => pack.name)).toEqual(['Español']);
    expect(await store.get('p1')).not.toBeNull();
    await store.remove('p1');
    expect(await store.list()).toEqual([]);
  });
});
