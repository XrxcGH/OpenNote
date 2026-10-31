import { describe, expect, it } from 'vitest';
import { baseInventory, checkClass, difference, editInventory, naturalClass, parseBundle, segments } from './features';
import { checkGloss } from './gloss';
import { applyRule, derive, interaction, parseRule } from './rules';
import { syllabify } from './syllables';
import { BracketError, crossingArcs, parseBrackets, parseDependencies, treeStats } from './trees';
import { bark, lobanov, normalize, parseFormants } from './vowels';

const inv = baseInventory();

describe('syntax and dependency trees', () => {
  it('read [S [NP the cat] [VP sat]] as S over NP and VP with 3 words and depth 3', () => {
    const root = parseBrackets('[S [NP the cat] [VP sat]]');
    expect(root.label).toBe('S');
    expect(root.children.map((c) => c.label)).toEqual(['NP', 'VP']);
    expect(root.children[0].children.map((c) => c.label)).toEqual(['the', 'cat']);
    expect(root.children[1].children.map((c) => c.label)).toEqual(['sat']);
    expect(treeStats(root)).toEqual({ leaves: ['the', 'cat', 'sat'], depth: 3, phrases: 3 });
  });

  it('draw a triangle and say where a bracket is wrong', () => {
    expect(parseBrackets('[S [NP^ the old cat] [VP sat]]').children[0].triangle).toBe(true);
    expect(() => parseBrackets('[S [NP the cat]')).toThrow('unclosed');
    expect(() => parseBrackets('[S cat]]')).toThrow('extraClose');
    try {
      parseBrackets('[S [NP the cat] []]');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BracketError);
      expect((error as BracketError).position).toBe(16);
    }
    expect(() => parseBrackets('  ')).toThrow('empty');
    expect(() => parseBrackets('cat')).toThrow('start');
  });

  it('read a dependency tree and find crossing arcs', () => {
    const deps = parseDependencies('the 2 det\ncat 3 nsubj\nsat 0 root');
    expect(deps[1]).toEqual({ index: 2, word: 'cat', head: 3, relation: 'nsubj' });
    expect(crossingArcs(deps)).toEqual([]);
    expect(crossingArcs(parseDependencies('a 3\nb 4\nc 0\nd 3'))).toEqual([[1, 2]]);
    expect(() => parseDependencies('a 2\nb 1')).toThrow('depRoot');
    expect(() => parseDependencies('a 0\nb 3\nc 2')).toThrow('depCycle');
    expect(() => parseDependencies('a 0\nb 9')).toThrow('depHead');
  });
});

describe('interlinear glosses', () => {
  it('align kitap-lar-im with book-PL-1SG.POSS', () => {
    const r = checkGloss('kitap-lar-im', 'book-PL-1SG.POSS', 'my books');
    expect(r.problems).toEqual([]);
    expect(r.words[0].morphemes).toEqual([
      { form: 'kitap', gloss: 'book' },
      { form: 'lar', gloss: 'PL' },
      { form: 'im', gloss: '1SG.POSS' },
    ]);
    expect(r.labels.map((l) => l.label)).toEqual(['PL', '1', 'SG', 'POSS']);
    expect(r.labels.every((l) => l.meaning !== null)).toBe(true);
  });

  it('report a missing gloss with the word and its position', () => {
    const r = checkGloss('ev-ler gel-di', 'house-PL');
    expect(r.problems).toEqual([
      { position: 2, word: 'gel-di', gloss: '', kind: 'missingGloss', forms: 2, glosses: 0 },
    ]);
    expect(checkGloss('kitap-lar-im', 'book-PL').problems[0].kind).toBe('morphemes');
    expect(checkGloss('kitap=im', 'book-1SG').problems[0].kind).toBe('joiners');
    expect(checkGloss('a', 'b-XYZ').labels.find((l) => l.label === 'XYZ')?.meaning).toBeNull();
    expect(() => checkGloss(' ', 'x')).toThrow('empty');
  });
});

describe('distinctive features', () => {
  it('split segments by the longest match and keep diacritics', () => {
    expect(segments('tʃatʰaː', inv)).toEqual(['tʃ', 'a', 'tʰ', 'aː']);
  });

  it('find the nasals and the difference between p and b', () => {
    expect(naturalClass(parseBundle('[+nasal]'), inv)).toEqual(['m', 'n', 'ŋ']);
    expect(naturalClass(parseBundle('+voi -son +cont'), inv)).toEqual(['v', 'ð', 'z', 'ʒ', 'ɣ']);
    expect(difference('p', 'b', inv)).toEqual([{ feature: 'voi', a: '-', b: '+' }]);
    expect(() => parseBundle('[+wet]')).toThrow('feature');
  });

  it('tell a natural class from a set that is not one', () => {
    expect(checkClass(['p', 't', 'k'], inv).natural).toBe(true);
    expect(checkClass(['p', 't', 'm'], inv).natural).toBe(false);
    expect(checkClass(['m', 'n', 'ŋ'], inv).natural).toBe(true);
    expect(checkClass(['p', 'a'], inv).natural).toBe(false);
    expect(checkClass(['q'], inv).unknown).toEqual(['q']);
  });

  it('add a segment by its difference from one in the chart', () => {
    const more = editInventory('ɲ = n -ant +dor +high -low -back');
    expect(naturalClass(parseBundle('+nas'), more)).toEqual(['m', 'n', 'ŋ', 'ɲ']);
    expect(() => editInventory('ɲ = q +high')).toThrow('editBase');
  });
});

describe('rules and derivations', () => {
  it('voice t between vowels: /atapa/ becomes [adapa] and /tapa/ stays [tapa]', () => {
    const { rows } = derive('t -> d / V _ V', '/atapa/\n/tapa/', inv);
    expect(rows.map((r) => r.surface)).toEqual(['adapa', 'tapa']);
  });

  it('give [tep] for rules 1 then 2 and [tap] for 2 then 1 on /tapi/', () => {
    // Written a -> e / _ i, rule 1 needs i right after a, which tapi lacks, so the umlaut reaches across a consonant.
    expect(derive('a -> e / _ i', 'tapi', inv).rows[0].surface).toBe('tapi');
    const one = 'a -> e / _ C i';
    const two = 'i -> 0 / _ #';
    expect(derive(`${one}\n${two}`, 'tapi', inv).rows[0].surface).toBe('tep');
    expect(derive(`${two}\n${one}`, 'tapi', inv).rows[0].surface).toBe('tap');
    const r1 = parseRule(one, inv);
    const r2 = parseRule(two, inv);
    const form = segments('tapi', inv);
    expect(interaction(r2, r1, form, inv)).toBe('bleeding');
    expect(interaction(r1, r2, form, inv)).toBe('counterbleeding');
  });

  it('show feeding and counterfeeding', () => {
    const feed = parseRule('a -> i / _ #', inv);
    const pal = parseRule('k -> tʃ / _ i', inv);
    const form = segments('ka', inv);
    expect(interaction(feed, pal, form, inv)).toBe('feeding');
    expect(interaction(pal, feed, form, inv)).toBe('counterfeeding');
    expect(derive('k -> tʃ / _ i\na -> i / _ #', 'ka', inv).rows[0].surface).toBe('ki');
  });

  it('change features, insert, and read optional elements', () => {
    expect(applyRule(parseRule('[-son] -> [+voi] / V _ V', inv), segments('apa', inv), inv).join('')).toBe('aba');
    expect(applyRule(parseRule('0 -> ə / C _ C#', inv), segments('ast', inv), inv).join('')).toBe('asət');
    expect(applyRule(parseRule('a -> e / _ (C)i', inv), segments('ati', inv), inv).join('')).toBe('eti');
    expect(applyRule(parseRule('a -> e / _ (C)i', inv), segments('ai', inv), inv).join('')).toBe('ei');
    expect(() => parseRule('a e', inv)).toThrow('arrow');
    expect(() => parseRule('a -> e / i', inv)).toThrow('focus');
    expect(() => parseRule('[+nas] -> [+lat]', inv)).not.toThrow();
    expect(() => applyRule(parseRule('[+nas] -> [+lat]', inv), ['m'], inv)).toThrow('noSegment');
  });
});

describe('syllables and vowels', () => {
  it('split panda as pan.da with the onsets p, n, and d', () => {
    expect(syllabify('panda', 'p, n, d', inv).syllables.map((s) => s.join(''))).toEqual(['pan', 'da']);
    expect(syllabify('panda', '', inv).syllables.map((s) => s.join(''))).toEqual(['pan', 'da']);
    expect(syllabify('astra', 's, t, r, tr, st, str', inv).syllables.map((s) => s.join(''))).toEqual(['a', 'stra']);
    expect(syllabify('astra', '', inv).syllables.map((s) => s.join(''))).toEqual(['as', 'tra']);
    expect(() => syllabify('pst', '', inv)).toThrow('noVowel');
  });

  it('give Lobanov scores -1, 0, 1 for F1 300, 500, 700 Hz', () => {
    const z = lobanov([300, 500, 700]);
    expect(z[0]).toBeCloseTo(-1, 12);
    expect(z[1]).toBeCloseTo(0, 12);
    expect(z[2]).toBeCloseTo(1, 12);
    expect(() => lobanov([500])).toThrow('fewTokens');
    expect(() => lobanov([500, 500])).toThrow('noSpread');
  });

  it('read formants and work Bark values', () => {
    const tokens = parseFormants('i 300 2300 A\na 700 1200 A\nu 300 800 A');
    expect(tokens).toHaveLength(3);
    // By hand: 26.81 × 1000 / 2960 = 9.057432, less 0.53. F1 300, 700, 300 has mean 433.33 and sd 230.94.
    expect(bark(1000)).toBeCloseTo(8.527432, 5);
    expect(normalize(tokens, 'lobanov')[1].y).toBeCloseTo(1.1547005, 6);
    expect(() => parseFormants('i -3 2000')).toThrow('positive');
    expect(() => parseFormants('i x 2000')).toThrow('number');
  });
});
