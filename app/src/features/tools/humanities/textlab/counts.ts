// Counting text: words, sentences, and syllables, the readability formulas, and flags for passive voice,
// nominalizations, and hedges. Syllables are counted by spelling rules (vowel groups, a silent final e, and a few
// endings), so a count can be off by one on an unusual word. The flags are local heuristics and are labeled so.

/** Words: runs of letters, with inner apostrophes and hyphens kept (don't, well-known). */
export function words(text: string): string[] {
  return text.match(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu) ?? [];
}

/** Sentences end at ., !, or ? followed by a space or the end; a text with words and no end mark is one sentence. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])["'”’)\]]*\s+/u)
    .map((part) => part.trim())
    .filter((part) => words(part).length > 0);
}

/** Syllables in an English word, by spelling rules. */
export function syllables(word: string): number {
  let w = word
    .toLowerCase()
    .replace(/[’']s$/, '')
    .replace(/[^a-z]/g, '');
  if (w === '') return 0;
  if (w.length <= 3) return 1;
  // A final silent e, but not -le after a consonant (table) or -ee.
  w = w.replace(/(?:[^laeiouy]es|[^laeiouydt]ed|[^laeiouy]e)$/, (end) => end.slice(0, 1)).replace(/^y/, '');
  const groups = w.match(/[aeiouy]+/g)?.length ?? 0;
  return Math.max(1, groups);
}

export interface Readability {
  words: number;
  sentences: number;
  syllables: number;
  characters: number;
  complex: number;
  fleschEase: number;
  fleschKincaid: number;
  fog: number;
  smog: number;
  colemanLiau: number;
  ari: number;
}

/** The standard formulas. SMOG uses its normalization to 30 sentences, so short texts give a rough value. */
export function readability(text: string): Readability {
  const list = words(text);
  const count = list.length;
  if (count === 0) throw new Error('empty');
  const sentenceCount = Math.max(1, sentences(text).length);
  const syllableCounts = list.map(syllables);
  const total = syllableCounts.reduce((sum, n) => sum + n, 0);
  const complex = syllableCounts.filter((n) => n >= 3).length;
  const characters = list.reduce((sum, word) => sum + word.replace(/['’-]/g, '').length, 0);
  const perSentence = count / sentenceCount;
  const perWord = total / count;
  return {
    words: count,
    sentences: sentenceCount,
    syllables: total,
    characters,
    complex,
    fleschEase: 206.835 - 1.015 * perSentence - 84.6 * perWord,
    fleschKincaid: 0.39 * perSentence + 11.8 * perWord - 15.59,
    fog: 0.4 * (perSentence + (100 * complex) / count),
    smog: 1.043 * Math.sqrt(complex * (30 / sentenceCount)) + 3.1291,
    colemanLiau: 0.0588 * ((characters / count) * 100) - 0.296 * ((sentenceCount / count) * 100) - 15.8,
    ari: 4.71 * (characters / count) + 0.5 * perSentence - 21.43,
  };
}

/** How many sentences have each length in words, for a histogram. */
export function sentenceLengths(text: string): number[] {
  return sentences(text).map((sentence) => words(sentence).length);
}

const BE = /^(am|is|are|was|were|be|been|being|get|got|gets|getting)$/i;
const IRREGULAR = new Set([
  'made',
  'done',
  'seen',
  'given',
  'taken',
  'written',
  'known',
  'shown',
  'found',
  'held',
  'built',
  'told',
  'thought',
  'brought',
  'kept',
  'left',
  'sent',
  'paid',
  'won',
  'lost',
  'set',
  'put',
  'read',
  'led',
  'born',
  'chosen',
  'driven',
  'eaten',
  'fallen',
  'forgotten',
  'hidden',
  'spoken',
  'stolen',
  'broken',
  'drawn',
  'grown',
  'thrown',
  'worn',
  'begun',
]);
const HEDGES = new Set([
  'perhaps',
  'possibly',
  'probably',
  'apparently',
  'arguably',
  'seemingly',
  'somewhat',
  'likely',
  'might',
  'may',
  'could',
  'seem',
  'seems',
  'suggest',
  'suggests',
  'appear',
  'appears',
  'generally',
  'largely',
  'relatively',
  'fairly',
  'rather',
  'quite',
]);
const NOMINAL = /(?:tion|sion|ment|ness|ity|ance|ence|ism|ization|isation)s?$/i;

export interface Flag {
  kind: 'passive' | 'nominalization' | 'hedge';
  /** The word or words flagged, as written. */
  text: string;
  /** The index of the first word. */
  at: number;
}

/** Heuristic flags: a form of be or get followed (within one word) by a past participle; long -tion and -ment
 * nouns; and hedging words. */
export function flags(text: string): Flag[] {
  const list = words(text);
  const out: Flag[] = [];
  const participle = (word: string) => /ed$/i.test(word) || IRREGULAR.has(word.toLowerCase());
  list.forEach((word, i) => {
    if (BE.test(word)) {
      const next = list[i + 1];
      const after = list[i + 2];
      if (next && participle(next)) out.push({ kind: 'passive', text: `${word} ${next}`, at: i });
      else if (next && /ly$/i.test(next) && after && participle(after))
        out.push({ kind: 'passive', text: `${word} ${next} ${after}`, at: i });
    }
    if (word.length > 6 && NOMINAL.test(word)) out.push({ kind: 'nominalization', text: word, at: i });
    if (HEDGES.has(word.toLowerCase())) out.push({ kind: 'hedge', text: word, at: i });
  });
  return out;
}

export interface LanguageSample {
  utterances: number;
  words: number;
  morphemes: number;
  mluMorphemes: number;
  mluWords: number;
  differentWords: number;
  perUtterance: number[];
}

/** A language sample, one utterance a line, with morphemes marked by hyphens (eat-ing, dog-s). */
export function languageSample(text: string): LanguageSample {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) throw new Error('empty');
  const perUtterance: number[] = [];
  let wordCount = 0;
  const roots = new Set<string>();
  for (const line of lines) {
    const tokens = line.split(/\s+/).filter((token) => /\p{L}/u.test(token));
    wordCount += tokens.length;
    perUtterance.push(tokens.reduce((sum, token) => sum + token.split('-').filter((part) => part !== '').length, 0));
    for (const token of tokens)
      roots.add(
        token
          .toLowerCase()
          .replace(/[^\p{L}-]/gu, '')
          .replace(/-/g, ''),
      );
  }
  const morphemes = perUtterance.reduce((sum, n) => sum + n, 0);
  return {
    utterances: lines.length,
    words: wordCount,
    morphemes,
    mluMorphemes: morphemes / lines.length,
    mluWords: wordCount / lines.length,
    differentWords: roots.size,
    perUtterance,
  };
}
