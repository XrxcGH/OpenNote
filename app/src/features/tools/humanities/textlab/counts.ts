// Counting text: words, sentences, and syllables, the readability formulas, and flags for passive voice,
// nominalizations, and hedges. Syllables are counted by spelling rules (vowel groups, a silent final e, and a few
// endings), so a count can be off by one on an unusual word. The flags are local heuristics and are labeled so.

/** Words: runs of letters, with inner apostrophes and hyphens kept (don't, well-known). */
export function words(text: string): string[] {
  return text.match(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu) ?? [];
}

/** Titles that are never the last word of a sentence. */
const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'mx', 'prof', 'st', 'mt', 'rev', 'gen', 'sgt', 'capt', 'lt', 'col']);
/** Abbreviations that stay inside the sentence before any word. */
const INNER = new Set(['e.g', 'i.e', 'vs', 'cf', 'viz', 'approx', 'fig', 'ca']);
/** Abbreviations that can end a sentence, so they join only when the next word is lowercase or a number. */
const ENDING = new Set(['etc', 'no', 'jr', 'sr', 'inc', 'ltd', 'co', 'al', 'p', 'pp', 'vol', 'ed']);

/** Whether a period after the last word of this piece is an abbreviation's rather than the sentence's end. */
function abbreviationEnd(piece: string, next: string): boolean {
  const last = /([\p{L}.]+)\.["'”’)\]]*$/u.exec(piece)?.[1];
  if (!last) return false;
  const word = last.toLowerCase();
  if (TITLES.has(word) || INNER.has(word)) return true;
  // An initial: one capital letter, as in J. R. Tolkien.
  if (/^\p{Lu}$/u.test(last)) return true;
  const lowerNext = /^["'“‘(\[]*[\p{Ll}\d]/u.test(next);
  // A dotted acronym (U.S., a.m.) or an abbreviation that may end a sentence.
  return lowerNext && (ENDING.has(word) || /^(?:\p{L}\.)+\p{L}$/u.test(last));
}

/**
 * Sentences end at ., !, or ? followed by a space or the end; a text with words and no end mark is one sentence. A
 * period after a title (Dr.), an initial, or e.g. does not end one, nor after etc. or a dotted acronym (U.S.) when the
 * next word is lowercase.
 */
export function sentences(text: string): string[] {
  const pieces = text.split(/(?<=[.!?…])["'”’)\]]*\s+/u).map((part) => part.trim());
  const out: string[] = [];
  let carry = '';
  pieces.forEach((piece, i) => {
    const joined = carry === '' ? piece : `${carry} ${piece}`;
    if (i < pieces.length - 1 && piece.endsWith('.') && abbreviationEnd(piece, pieces[i + 1]!)) carry = joined;
    else {
      out.push(joined);
      carry = '';
    }
  });
  return out.filter((part) => words(part).length > 0);
}

/** Words whose syllables the spelling rules get wrong: -ed adjectives and a few vowel pairs. */
const SYLLABLE_WORDS: Record<string, number> = {
  naked: 2,
  wicked: 2,
  crooked: 2,
  ragged: 2,
  rugged: 2,
  jagged: 2,
  sacred: 2,
  beloved: 3,
  learned: 2,
  ideal: 3,
  plea: 1,
  people: 2,
  business: 2,
  evening: 2,
};

// Vowel pairs said as two syllables: li-on, tri-al, me-di-um, du-al, po-em, cre-ate, vi-de-o, are-a. Not after
// c, s, t, or g before n, l, or u, or after ll, where the i is a glide (nation, social, religion, gracious, million).
const HIATUS = [
  /(?<![cgstxl])i[aou]|(?<!l)li[aou]|[cgstx]i(?:a(?![nl])|o(?![nu])|u(?!s))/g,
  /(?<![ct])ie(?=t|nc|nt)|scie(?=n)/g,
  /[^q]ua(?!y)|[^aeiouqg]uo/g,
  /oe(?=[mt])|^coe|crea(?=t)(?!tu)|^rea(?=ct|l[iy])|^geo|[^gcp]eo(?!u)|[^aeiou]ea$|eum$/g,
  // gi-ant, cru-el, fu-el, du-et, be-ing, go-ing; rhy-thm, pri-sm, re-al-i-sm: a final m after th or s is a syllable.
  /^gian|(?<![gq])ue(?=[lt])|thms?$|sms?$|[aeiouy]ing$/g,
];

/** Syllables in an English word, by spelling rules. */
export function syllables(word: string): number {
  let w = word
    .toLowerCase()
    .replace(/[’']s$/, '')
    .replace(/[^a-z]/g, '');
  if (w === '') return 0;
  const known = SYLLABLE_WORDS[w];
  if (known !== undefined) return known;
  if (w.length <= 3) return 1;
  // A silent e before a suffix (hopeful, lovely, statement).
  w = w.replace(/([^aeiouy])e(ful|fully|less|ness|ment|ments|ly)$/, '$1$2');
  // A final silent e, but not -le after a consonant (table) or -ee. The -es of a plural is a syllable after s, x,
  // z, ch, sh, ce, and ge (horses, boxes, churches, changes), and -ed after t or d (wanted, created).
  if (!/(?:[sxz]|ch|sh|[cg])es$/.test(w)) {
    w = w.replace(/(?:[^laeiouy]es|[^laeiouydt]ed|[^laeiouy]e)$/, (end) => end.slice(0, 1));
  }
  // A silent -ue after g (league, tongue, vague), but not in argue.
  w = w.replace(/(?<!r)gue$/, 'g');
  w = w.replace(/^y/, '');
  const groups = w.match(/[aeiouy]+/g)?.length ?? 0;
  const splits = HIATUS.reduce((sum, rule) => sum + (w.match(rule)?.length ?? 0), 0);
  return Math.max(1, groups + splits);
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
