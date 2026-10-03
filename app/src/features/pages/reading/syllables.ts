// Syllable breaks for the reading view. English only, and a heuristic: it finds vowel groups, drops the silent endings,
// and splits the consonants between them by the usual rules. It is right for most common words and wrong for some, so a
// breaking dictionary can replace it later without changing the callers. Other languages are left whole.

export const SOFT_HYPHEN = '­';

/** The shortest word that gets breaks, in letters. */
export const MIN_WORD = 5;
/** The fewest letters either side of a break. */
const MIN_SIDE = 2;

const DIGRAPHS = new Set(['th', 'sh', 'ch', 'ph', 'wh']);
/** Endings that are a syllable of their own when something longer comes before them. */
const SUFFIXES = ['ing', 'ings', 'ness', 'ment', 'ments', 'less', 'ful', 'ly'];

const isVowelAt = (w: string, i: number): boolean => {
  const c = w[i];
  if ('aeiou'.includes(c)) return true;
  // A y is a vowel except when it starts a word before a vowel, as in "yes".
  return c === 'y' && !(i === 0 && i + 1 < w.length && 'aeiou'.includes(w[i + 1]));
};

interface Group {
  start: number;
  end: number;
}

function vowelGroups(w: string): Group[] {
  const out: Group[] = [];
  for (let i = 0; i < w.length; i += 1) {
    if (!isVowelAt(w, i)) continue;
    const last = out.at(-1);
    if (last && last.end === i) last.end = i + 1;
    else out.push({ start: i, end: i + 1 });
  }
  return out;
}

/** Drops the vowel group of a silent ending ("make", "jumped") so it joins the syllable before it. */
function withoutSilentEnding(w: string, groups: Group[]): Group[] {
  const last = groups.at(-1);
  if (!last || groups.length < 2 || last.end - last.start !== 1 || w[last.start] !== 'e') return groups;
  const atEnd = last.end === w.length;
  const beforeConsonant = last.end === w.length - 1 && 'ds'.includes(w[w.length - 1]);
  if (atEnd) {
    // "table" keeps its e: a consonant and "le" make a syllable.
    const consonantLe = w[last.start - 1] === 'l' && last.start >= 2 && !isVowelAt(w, last.start - 2);
    return consonantLe ? groups : groups.slice(0, -1);
  }
  if (beforeConsonant) {
    const before = w[last.start - 1];
    const sounded = w[w.length - 1] === 'd' ? 'td'.includes(before) : 'sxzcg'.includes(before) || w.endsWith('hes');
    return sounded ? groups : groups.slice(0, -1);
  }
  return groups;
}

/** Where a break falls in the consonants between two vowel groups, as an index into the word. */
function breakBetween(w: string, a: Group, b: Group): number {
  const cluster = w.slice(a.end, b.start);
  if (cluster.length === 0) return b.start;
  // "table": a consonant and a final "le" go together.
  if (b.end === w.length && w.endsWith('le') && cluster.length >= 2 && b.end - b.start === 1) return b.start - 2;
  if (cluster.length === 1) return cluster === 'x' ? b.start : a.end;
  if (cluster.endsWith('ck') || cluster.endsWith('ng')) return b.start;
  if (DIGRAPHS.has(cluster.slice(-2))) return b.start - 2;
  return a.end + 1;
}

/** The syllables of a lowercase or mixed-case English word of letters. Anything else comes back whole. */
export function syllables(word: string, language = 'en'): string[] {
  if (!/^[A-Za-z]+$/.test(word) || !/^en(-|$)/i.test(language) || word.length < MIN_WORD) return [word];
  const w = word.toLowerCase();
  const groups = withoutSilentEnding(w, vowelGroups(w));
  if (groups.length < 2) return [word];
  const cuts = new Set<number>();
  for (let i = 0; i + 1 < groups.length; i += 1) cuts.add(breakBetween(w, groups[i], groups[i + 1]));
  // A suffix is a syllable of its own: "read-ing", not "rea-ding".
  for (const suffix of SUFFIXES) {
    const at = w.length - suffix.length;
    if (!w.endsWith(suffix) || at < 3) continue;
    const stem = groups.filter((g) => g.end <= at);
    const rest = groups.filter((g) => g.start >= at);
    // A doubled consonant before the suffix splits between the two ("run-ning"), so the suffix rule leaves it.
    if (stem.length > 0 && rest.length > 0 && w[at - 1] !== w[at - 2]) {
      for (const cut of [...cuts]) if (cut >= stem[stem.length - 1].end && cut <= rest[0].start) cuts.delete(cut);
      cuts.add(at);
      break;
    }
  }
  const points = [...cuts].filter((c) => c > 0 && c < w.length).sort((a, b) => a - b);
  const parts: string[] = [];
  let from = 0;
  for (const point of points) {
    parts.push(word.slice(from, point));
    from = point;
  }
  parts.push(word.slice(from));
  // A part with no vowel, or too short a side, joins its neighbor.
  const merged: string[] = [];
  for (const part of parts) {
    const previous = merged.at(-1);
    if (previous !== undefined && (part.length < MIN_SIDE || previous.length < MIN_SIDE))
      merged[merged.length - 1] += part;
    else merged.push(part);
  }
  return merged;
}

export interface BreakOptions {
  /** A BCP 47 tag. Only English is broken. */
  readonly language?: string;
  /** What goes between syllables: a soft hyphen (the default) lets the browser wrap at the break, a middle dot shows it. */
  readonly separator?: string;
  readonly minWord?: number;
}

const SKIP = /[\d@/\\_#]/;

/**
 * Puts a break between the syllables of the words in some plain text. A word with a digit, an address, or a path in it
 * is left alone. Apply it to text nodes only, never to code.
 */
export function breakText(text: string, options: BreakOptions = {}): string {
  const { language = 'en', separator = SOFT_HYPHEN, minWord = MIN_WORD } = options;
  if (!/^en(-|$)/i.test(language)) return text;
  return text
    .split(/(\s+)/)
    .map((token) =>
      SKIP.test(token)
        ? token
        : token.replace(/[A-Za-z]+/g, (word) =>
            word.length < minWord ? word : syllables(word, language).join(separator),
          ),
    )
    .join('');
}

/** Removes the breaks again, for copying text out of a reading view. */
export function withoutBreaks(text: string): string {
  return text.replaceAll(SOFT_HYPHEN, '');
}
