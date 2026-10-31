import { describe, expect, it } from 'vitest';
import { flags, languageSample, readability, sentences, syllables, words } from './counts';
import {
  collocates,
  frequencies,
  gSquared,
  keyness,
  kwic,
  movingTtr,
  mutualInformation,
  ngrams,
  tokens,
  typeTokenRatio,
} from './corpus';
import { diffWords, variants } from './diff';
import { fitHexameter, fitPentameter, latinSyllables, rhymeScheme, scanEnglish, wordStress } from './scansion';

describe('counts and readability', () => {
  it('score "The cat sat on the mat." as Flesch 116.145 and grade -1.45', () => {
    const r = readability('The cat sat on the mat.');
    expect([r.words, r.sentences, r.syllables]).toEqual([6, 1, 6]);
    // 206.835 - 1.015 × 6 - 84.6 × 1 and 0.39 × 6 + 11.8 × 1 - 15.59, by hand.
    expect(r.fleschEase).toBeCloseTo(116.145, 9);
    expect(r.fleschKincaid).toBeCloseTo(-1.45, 9);
  });

  it('count syllables by rule', () => {
    expect(['compare', "summer's", 'table', 'wanted', 'used', 'beautiful', 'the'].map(syllables)).toEqual([
      2, 2, 2, 2, 1, 3, 1,
    ]);
  });

  it('count the plural -es after a sibilant, -ed after t or d, and vowels said apart', () => {
    // Syllable counts from the CMU Pronouncing Dictionary.
    const cases: [string, number][] = [
      ['sentences', 3],
      ['horses', 2],
      ['boxes', 2],
      ['changes', 2],
      ['wishes', 2],
      ['churches', 2],
      ['created', 3],
      ['naked', 2],
      ['ideal', 3],
      ['area', 3],
      ['poem', 2],
      ['makes', 1],
      ['jumped', 1],
      ['nation', 2],
      ['lion', 2],
      ['million', 2],
      ['quiet', 2],
      ['great', 1],
      ['hopeful', 2],
      ['reality', 4],
      ['realize', 3],
      ['museum', 3],
      ['cruel', 2],
      ['giant', 2],
      ['rhythm', 2],
      ['coexist', 3],
      ['being', 2],
      ['duet', 2],
      ['league', 1],
      ['tongue', 1],
      ['argue', 2],
      ['prism', 2],
      ['really', 2],
    ];
    expect(cases.map(([word]) => syllables(word))).toEqual(cases.map(([, n]) => n));
    // 8 words, 2 sentences, 10 syllables: FRE = 206.835 − 1.015·4 − 84.6·1.25 = 97.025, FK = 0.39·4 + 11.8·1.25 − 15.59 = 0.72.
    const r = readability('This is a test. It has two sentences.');
    expect(r.syllables).toBe(10);
    expect(r.fleschEase).toBeCloseTo(97.025, 3);
    expect(r.fleschKincaid).toBeCloseTo(0.72, 3);
  });

  it('split sentences and refuse an empty text', () => {
    expect(sentences('One. Two words! Three? ')).toHaveLength(3);
    // Two sentences each: abbreviations do not end one, but a sentence may still end on one.
    expect(sentences('Dr. Smith met Mr. Jones yesterday. It rained all day.')).toEqual([
      'Dr. Smith met Mr. Jones yesterday.',
      'It rained all day.',
    ]);
    expect(sentences('Bring fruit, e.g. apples. The U.S. economy grew.')).toHaveLength(2);
    expect(sentences('J. R. R. Tolkien wrote it. He lived in the U.S. Then he left.')).toHaveLength(3);
    expect(sentences('Pens, ink, etc. are sold here. We close at five.')).toHaveLength(2);
    expect(words("Don't stop well-known")).toEqual(["Don't", 'stop', 'well-known']);
    expect(() => readability('  ...  ')).toThrow('empty');
  });

  it('flag passive voice, nominalizations, and hedges', () => {
    const found = flags('The report was written quickly. Perhaps the implementation was badly managed.');
    expect(found.map((flag) => flag.kind)).toEqual(['passive', 'hedge', 'nominalization', 'passive']);
  });

  it('give an MLU of 3.0 morphemes for doggie go, mommy eat-ing, big dog-s run', () => {
    const sample = languageSample('doggie go\nmommy eat-ing\nbig dog-s run');
    expect(sample.perUtterance).toEqual([2, 3, 4]);
    expect(sample.mluMorphemes).toBe(3);
    expect(sample.mluWords).toBeCloseTo(7 / 3, 12);
    expect(sample.differentWords).toBe(7);
  });
});

describe('word lists and corpus measures', () => {
  it('give a type-token ratio of 0.8 for "the cat and the hat"', () => {
    expect(typeTokenRatio(tokens('the cat and the hat'))).toBe(0.8);
    expect(movingTtr(tokens('the cat and the hat'), 50)).toBe(0.8);
    expect(() => typeTokenRatio([])).toThrow('empty');
  });

  it('count frequencies and bigrams', () => {
    const list = tokens('the cat and the hat and the bat');
    expect(frequencies(list)[0]).toEqual(['the', 3]);
    expect(frequencies(list, true).map(([word]) => word)).toEqual(['bat', 'cat', 'hat']);
    expect(ngrams(list, 2)[0]).toEqual(['and the', 2]);
    expect(() => ngrams(list, 0)).toThrow('ngram');
  });

  it('score MI 4.32193 for O 10, N 10 000, f1 100, f2 50, and keyness 19.3942', () => {
    // log2(10 × 10 000 / (100 × 50)) = log2 20.
    expect(mutualInformation(10, 10000, 100, 50)).toBeCloseTo(Math.log2(20), 12);
    expect(mutualInformation(10, 10000, 100, 50)).toBeCloseTo(4.32193, 5);
    expect(keyness(50, 10000, 20, 12000).g2).toBeCloseTo(19.3942, 3);
    expect(gSquared(10, 10, 10, 10)).toBeCloseTo(0, 12);
    expect(() => mutualInformation(0, 10, 1, 1)).toThrow('positive');
  });

  it('build a concordance sorted by the right context', () => {
    const lines = kwic('a red fox ran. the red apple fell. one red bird sang', 'red', 2, 'right');
    expect(lines.map((line) => line.right)).toEqual(['apple fell', 'bird sang', 'fox ran']);
    expect(() => kwic('text', '  ')).toThrow('query');
  });

  it('find collocates of a node word', () => {
    const list = tokens('strong tea strong tea strong coffee weak tea strong tea');
    const found = collocates(list, 'strong', 1);
    expect(found[0]!.word).toBe('tea');
    expect(() => collocates(list, 'milk')).toThrow('notFound');
  });
});

describe('comparing versions', () => {
  it('list each variant between two readings', () => {
    const a = 'arma virumque cano troiae qui primus ab oris'.split(' ');
    const b = 'arma uirumque cano troiae qui primus ab oris italiam'.split(' ');
    const ops = diffWords(a, b);
    expect(ops.filter((op) => op.kind === 'same')).toHaveLength(7);
    expect(variants(ops)).toEqual([
      { at: 2, base: 'virumque', witness: 'uirumque' },
      { at: 8, base: '', witness: 'italiam' },
    ]);
    expect(variants(diffWords(a, a))).toEqual([]);
  });
});

describe('scansion', () => {
  it('scan the first line of the Aeneid as DDSSDS', () => {
    const { syllables: list } = latinSyllables('Arma virumque cano, Troiae qui primus ab oris');
    expect(list).toHaveLength(15);
    expect(fitHexameter(list.map((s) => s.weight))).toEqual(['DDSSDS']);
  });

  it('elide before a vowel and use macrons', () => {
    const { syllables: list, elided } = latinSyllables('conticuere omnes intentique ora tenebant');
    expect(elided).toEqual(['conticuere', 'intentique']);
    // con-ti-cu-e-rom-nes-in-ten-ti-quo-ra-te-ne-bant: 14 syllables after two elisions, scanned DSSSDS.
    expect(list).toHaveLength(14);
    expect(fitHexameter(list.map((s) => s.weight))).toContain('DSSSDS');
    expect(latinSyllables('rōmā').syllables[0]!.weight).toBe('long');
  });

  it('read a capital long vowel at the start of a line', () => {
    // Aeneid 2.3: Īn-fan | dum rē | gī-na-iu | bēs re-no | vā-re-do | lō-rem, 15 syllables, SSDDDS.
    const { syllables: list } = latinSyllables('Īnfandum, rēgīna, iubēs renovāre dolōrem');
    expect(list).toHaveLength(15);
    expect(list[0]).toMatchObject({ weight: 'long', reason: 'nature' });
    expect(fitHexameter(list.map((s) => s.weight))).toEqual(['SSDDDS']);
    // The same capital typed as O plus a combining macron.
    const decomposed = latinSyllables('Ōra tenēbant').syllables;
    expect(decomposed).toHaveLength(5);
    expect(decomposed[0]!.weight).toBe('long');
  });

  it('fit a pentameter', () => {
    const { syllables: list } = latinSyllables('īnferior rapidō flūmine Thybris abit');
    expect(fitPentameter(list.map((s) => s.weight)).length).toBeGreaterThan(0);
  });

  it('count 10 syllables in "Shall I compare thee to a summer\'s day?" and fit iambic pentameter', () => {
    const scan = scanEnglish("Shall I compare thee to a summer's day?");
    expect(scan.syllables).toBe(10);
    expect(scan.meter).toBe('iambic');
    expect(scan.feet).toBe(5);
  });

  it('keep the stress of a stem before a neutral suffix and after under- or over-', () => {
    expect(['delightful', 'understand', 'understanding', 'beautiful', 'remember'].map(wordStress)).toEqual([
      [0, 1, 0],
      [0, 0, 1],
      [0, 0, 1, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });

  it('stress common words on the penult where the rule would not', () => {
    // CMU: banana B AH0 N AE1 N AH0, museum M Y UW0 Z IY1 AH0 M, tomorrow T AH0 M AA1 R OW2.
    expect(['banana', 'museum', 'tomorrow', 'potatoes'].map(wordStress)).toEqual([
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
    ]);
  });

  it('find a rhyme scheme', () => {
    expect(rhymeScheme(['The day', 'the night', 'away', 'the light'])).toBe('ABAB');
    expect(() => scanEnglish('  ')).toThrow('empty');
  });
});
