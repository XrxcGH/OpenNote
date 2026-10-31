// Scansion. English lines are scanned by stress: syllables from spelling rules, stress from prefix and suffix
// rules, function words taken as light, and the meter that costs least wins. Latin lines are scanned by quantity:
// syllable weight from macrons, diphthongs, and position, with elision, fitted to the dactylic hexameter or the
// pentameter. Without macrons a vowel's own length is unknown, so every pattern that fits is listed.
import { syllables, words } from './counts';

const FUNCTION_WORDS = new Set(
  (
    'a an the and but or nor for so yet to of in on at by with from as is am are was were be been i me my thee ' +
    'thy you he she it we they him her us them his its our their shall will would can could may might must do ' +
    'does did has have had not no if than that this these those what which who whom whose when where while o'
  ).split(' '),
);
const PREFIXES = /^(a|be|com|con|de|dis|ex|for|in|mis|pre|pro|re|un|sur|per|sub|en|em|ob)/;

// Suffixes that never take the stress: it stays where it was in the stem (de-LIGHT-ful, for-GIVE-ness).
const NEUTRAL_SUFFIX = /(?:fully|ful|less|ness|ment|ly|ing|ings|er|ers)$/;
// under- and over- compounds stress the word they are joined to (under-STAND, over-COME).
const COMPOUND_PREFIX = /^(under|over)(?=[a-z]{3})/;

function stemStress(lower: string, count: number): number[] {
  const pattern = new Array<number>(count).fill(0);
  if (count === 2) pattern[PREFIXES.test(lower) && lower.length > 4 ? 1 : 0] = 1;
  else if (/(tion|sion|ic|ian|ial|ious)s?$/.test(lower)) pattern[count - 2] = 1;
  else pattern[count - 3] = 1;
  return pattern;
}

/** Stress guessed from spelling, or null when the parts do not add up to the word's syllables. */
function ruleStress(lower: string, count: number): number[] | null {
  const compound = COMPOUND_PREFIX.exec(lower);
  if (compound) {
    const rest = lower.slice(compound[1]!.length);
    const head = syllables(compound[1]!);
    const tail = ruleStress(rest, syllables(rest)) ?? stemStress(rest, syllables(rest));
    const parts = [...new Array<number>(head).fill(0), ...tail.map((n) => (n > 0.5 ? 1 : 0))];
    if (tail.length === 1) parts[head] = 1;
    return parts.length === count ? parts : null;
  }
  const suffix = NEUTRAL_SUFFIX.exec(lower);
  if (suffix && count > 2) {
    const stem = lower.slice(0, suffix.index);
    const stemCount = syllables(stem);
    const tail = count - stemCount;
    if (stem.length > 2 && stemCount >= 1 && tail >= 1) {
      // A stem whose y became i (beauty, plenty, happy) keeps its stress on the first syllable.
      const head =
        stemCount === 1
          ? [1]
          : /i$/.test(stem)
            ? [1, ...new Array<number>(stemCount - 1).fill(0)]
            : stemStress(stem, stemCount);
      return [...head, ...new Array<number>(tail).fill(0)];
    }
  }
  return null;
}

// Common words stressed on the penult that the antepenult rule gets wrong, by the CMU Pronouncing Dictionary.
const PENULT_WORDS = new Set(
  (
    'banana bananas tomato tomatoes potato potatoes vanilla umbrella important tomorrow together another ' +
    'however already museum computer idea ideas enormous horizon eleven remainder espresso piano mosquito ' +
    'arena aroma diploma volcano tobacco example sincerely forever whatever whoever'
  ).split(' '),
);

/** Stress of each syllable of a word: 1 stressed, 0 not, 0.5 a monosyllable that can go either way. */
export function wordStress(word: string): number[] {
  const lower = word.toLowerCase().replace(/[’']s$/, '');
  const count = syllables(word);
  if (count >= 3 && PENULT_WORDS.has(lower)) return Array.from({ length: count }, (_, i) => (i === count - 2 ? 1 : 0));
  if (count === 1) return [FUNCTION_WORDS.has(lower) ? 0.25 : 0.75];
  return ruleStress(lower, count) ?? stemStress(lower, count);
}

export type Meter = 'iambic' | 'trochaic' | 'anapestic' | 'dactylic';
const FEET: Record<Meter, number[]> = { iambic: [0, 1], trochaic: [1, 0], anapestic: [0, 0, 1], dactylic: [1, 0, 0] };

export interface EnglishScan {
  syllables: number;
  stresses: number[];
  meter: Meter;
  feet: number;
  /** The stress pattern of the best fit, as 0 and 1. */
  pattern: number[];
  cost: number;
}

export function scanEnglish(line: string): EnglishScan {
  const list = words(line);
  if (list.length === 0) throw new Error('empty');
  const stresses = list.flatMap(wordStress);
  const fits = (Object.keys(FEET) as Meter[]).map((meter) => {
    const foot = FEET[meter];
    const pattern = stresses.map((_, i) => foot[i % foot.length]!);
    const cost = stresses.reduce((sum, stress, i) => sum + Math.abs(stress - pattern[i]!), 0);
    return { meter, pattern, cost, feet: Math.ceil(stresses.length / foot.length) };
  });
  const best = fits.reduce((a, b) => (b.cost < a.cost - 1e-9 ? b : a));
  return { syllables: stresses.length, stresses, ...best };
}

/** The end of a line's last word that a rhyme shares: its last vowel group and what follows. */
export function rhymePart(line: string): string {
  const last =
    words(line)
      .at(-1)
      ?.toLowerCase()
      .replace(/[’']s$/, '')
      .replace(/[^a-z]/g, '') ?? '';
  const silent = /[^aeiouy]e$/.test(last) && last.length > 3;
  const stem = silent ? last.slice(0, -1) : last;
  const match = /[aeiouy]+[^aeiouy]*$/.exec(stem);
  return match ? match[0] + (silent ? 'e' : '') : last;
}

/** Letters for the rhyme scheme: lines with the same rhyme part share a letter. */
export function rhymeScheme(lines: readonly string[]): string {
  const seen = new Map<string, string>();
  return lines
    .map((line) => {
      const part = rhymePart(line);
      if (!seen.has(part)) seen.set(part, String.fromCharCode(65 + (seen.size % 26)));
      return seen.get(part)!;
    })
    .join('');
}

export type Weight = 'long' | 'short' | 'either' | 'unknown' | 'anceps';

export interface LatinSyllable {
  text: string;
  weight: Weight;
  /** Why: nature, diphthong, position, mutaLiquida, hiatus, final, open. */
  reason: string;
}

const LONG = 'āēīōūȳ';
const SHORT = 'ăĕĭŏŭ';
const PLAIN: Record<string, string> = {
  ā: 'a',
  ē: 'e',
  ī: 'i',
  ō: 'o',
  ū: 'u',
  ȳ: 'y',
  ă: 'a',
  ĕ: 'e',
  ĭ: 'i',
  ŏ: 'o',
  ŭ: 'u',
};
const VOWEL = /[aeiouyāēīōūȳăĕĭŏŭ]/;
const MUTE = /[pbtdcgf]/;
const LIQUID = /[lr]/;

interface Unit {
  kind: 'vowel' | 'consonant';
  text: string;
  /** A consonant that counts as two (x, z, and i between vowels). */
  double?: boolean;
  long?: boolean;
  short?: boolean;
  diphthong?: boolean;
  wordEnd?: boolean;
}

function unitsOf(word: string): Unit[] {
  const w = word.toLowerCase();
  const units: Unit[] = [];
  for (let i = 0; i < w.length; i++) {
    const ch = w[i]!;
    const next = w[i + 1] ?? '';
    const prev = w[i - 1] ?? '';
    if (ch === 'h') continue;
    // qu and gu before a vowel: u is part of the consonant.
    if (ch === 'u' && (prev === 'q' || (prev === 'g' && w[i - 2] === 'n')) && VOWEL.test(next)) continue;
    if ((ch === 'i' || ch === 'j') && VOWEL.test(next) && (i === 0 || VOWEL.test(prev))) {
      units.push({ kind: 'consonant', text: 'i', double: i > 0 });
      continue;
    }
    if (ch === 'v') {
      units.push({ kind: 'consonant', text: 'v' });
      continue;
    }
    if (VOWEL.test(ch)) {
      const pair = (PLAIN[ch] ?? ch) + (PLAIN[next] ?? next);
      if (['ae', 'au', 'oe'].includes(pair) || (pair === 'eu' && /^(heu|neu|seu|ceu)$/.test(w))) {
        units.push({ kind: 'vowel', text: ch + next, diphthong: true, long: true });
        i++;
        continue;
      }
      units.push({ kind: 'vowel', text: ch, long: LONG.includes(ch), short: SHORT.includes(ch) });
      continue;
    }
    if (/[a-z]/.test(ch)) units.push({ kind: 'consonant', text: ch, double: ch === 'x' || ch === 'z' });
  }
  if (units.length > 0) units[units.length - 1]!.wordEnd = true;
  return units;
}

const startsWithVowel = (word: string) => /^h?[aeiouyāēīōūȳăĕĭŏŭ]/i.test(word) && !/^[ij][aeiou]/i.test(word);
const endsElidable = (word: string) => /[aeiouyāēīōūȳăĕĭŏŭ]m?$/i.test(word);

/** Syllables and weights of a Latin line, with elided syllables left out (and listed). */
export function latinSyllables(line: string): { syllables: LatinSyllable[]; elided: string[] } {
  // NFC first, so a macron typed as a combining mark is one letter; capitals with marks count as letters too.
  const list = line.normalize('NFC').match(/[a-zA-ZāēīōūȳăĕĭŏŭĀĒĪŌŪȲĂĔĬŎŬ]+/g) ?? [];
  if (list.length === 0) throw new Error('empty');
  const elided: string[] = [];
  const units: Unit[] = [];
  list.forEach((word, index) => {
    let word2 = word;
    const next = list[index + 1];
    if (next && endsElidable(word) && startsWithVowel(next)) {
      // Elision: the final vowel (and any m) is dropped before a word that starts with a vowel or h.
      const cut = word.replace(/[aeiouyāēīōūȳăĕĭŏŭ]+m?$/i, '');
      elided.push(word);
      word2 = cut;
    }
    units.push(...unitsOf(word2));
  });
  const vowels = units.map((unit, i) => (unit.kind === 'vowel' ? i : -1)).filter((i) => i >= 0);
  if (vowels.length === 0) throw new Error('empty');
  const result: LatinSyllable[] = vowels.map((at, n) => {
    const unit = units[at]!;
    const end = vowels[n + 1] ?? units.length;
    const between = units.slice(at + 1, end);
    const consonants = between.reduce((sum, c) => sum + (c.double ? 2 : 1), 0);
    const text = units
      .slice(n === 0 ? 0 : at, end)
      .map((u) => u.text)
      .join('');
    if (n === vowels.length - 1) return { text, weight: 'anceps', reason: 'final' };
    if (unit.diphthong) return { text, weight: 'long', reason: 'diphthong' };
    if (unit.long) return { text, weight: 'long', reason: 'nature' };
    if (consonants >= 2) {
      const [c1, c2] = between;
      if (between.length === 2 && c1 && c2 && MUTE.test(c1.text) && LIQUID.test(c2.text) && !c1.double)
        return { text, weight: 'either', reason: 'mutaLiquida' };
      return { text, weight: 'long', reason: 'position' };
    }
    if (unit.short) return { text, weight: 'short', reason: 'nature' };
    if (consonants === 0 && !unit.wordEnd) return { text, weight: 'short', reason: 'hiatus' };
    return { text, weight: 'unknown', reason: 'open' };
  });
  return { syllables: result, elided };
}

export type Foot = 'D' | 'S';

function template(feet: readonly Foot[]): ('L' | 'S')[] {
  return feet.flatMap((foot): ('L' | 'S')[] => (foot === 'D' ? ['L', 'S', 'S'] : ['L', 'L']));
}

const fitsTemplate = (weights: readonly Weight[], shape: readonly ('L' | 'S' | 'X')[]): boolean =>
  weights.length === shape.length &&
  weights.every((weight, i) => {
    const want = shape[i]!;
    if (want === 'X' || weight === 'either' || weight === 'unknown' || weight === 'anceps') return true;
    return want === 'L' ? weight === 'long' : weight === 'short';
  });

const COMBOS: Foot[][] = Array.from({ length: 16 }, (_, n) =>
  [3, 2, 1, 0].map((bit): Foot => ((n >> bit) & 1 ? 'S' : 'D')),
);

/** Every hexameter pattern the weights allow: feet 1 to 4 dactyl or spondee, a dactyl fifth, and a final foot of a
 * long and an anceps. A spondee fifth (a rare spondaic line) is tried only when no line with a dactyl fifth fits. */
export function fitHexameter(weights: readonly Weight[]): string[] {
  for (const fifth of ['D', 'S'] as Foot[]) {
    const out = COMBOS.filter((combo) =>
      fitsTemplate(weights, [...template([...combo, fifth]), 'L', 'X'] as ('L' | 'S' | 'X')[]),
    ).map((combo) => `${combo.join('')}${fifth}S`);
    if (out.length > 0) return out;
  }
  return [];
}

/** Every pentameter pattern: two feet (dactyl or spondee) and a long, then two dactyls and an anceps. */
export function fitPentameter(weights: readonly Weight[]): string[] {
  const out: string[] = [];
  for (const combo of COMBOS.slice(0, 16)
    .filter((_, n) => n % 4 === 0)
    .map((c) => c.slice(0, 2))) {
    const shape = [...template(combo), 'L', 'L', 'S', 'S', 'L', 'S', 'S', 'X'] as ('L' | 'S' | 'X')[];
    if (fitsTemplate(weights, shape)) out.push(`${combo.join('')}-|DD-`);
  }
  return out;
}
