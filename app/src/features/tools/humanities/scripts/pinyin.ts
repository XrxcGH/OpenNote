// Hanyu Pinyin: tone numbers to tone marks, and the Mandarin tone sandhi of the third tone, yi, and bu. The mark
// goes on an a or an e when the syllable has one, on the o of ou, and otherwise on the last vowel, which puts it on the
// second letter of iu and ui. Tone 5 or 0 is the neutral tone and has no mark. A v or u: stands for ü.

const MARKS: Record<string, string[]> = {
  a: ['ā', 'á', 'ǎ', 'à'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

export interface Syllable {
  letters: string;
  tone: number;
}

/** Splits "zhong1 guo2" into syllables with their tone numbers; a syllable without a number is neutral. */
export function syllablesOf(text: string): Syllable[] {
  const out: Syllable[] = [];
  for (const m of text.matchAll(/([A-Za-züÜv:]+)([0-5])?/g)) {
    const letters = m[1].replace(/u:|v/g, 'ü').replace(/U:|V/g, 'Ü');
    out.push({ letters, tone: m[2] === undefined ? 5 : Number(m[2]) });
  }
  return out;
}

/** The index of the vowel that carries the mark, or -1 when the syllable has no vowel. */
export function markIndex(letters: string): number {
  const lower = letters.toLowerCase();
  for (const v of ['a', 'e']) {
    const i = lower.indexOf(v);
    if (i >= 0) return i;
  }
  const ou = lower.indexOf('ou');
  if (ou >= 0) return ou;
  for (let i = lower.length - 1; i >= 0; i--) if ('iouü'.includes(lower[i])) return i;
  return -1;
}

export function markSyllable({ letters, tone }: Syllable): string {
  if (tone < 1 || tone > 4) return letters;
  const i = markIndex(letters);
  if (i < 0) return letters;
  const ch = letters[i];
  const marked = MARKS[ch.toLowerCase()][tone - 1];
  return letters.slice(0, i) + (ch === ch.toUpperCase() ? marked.toUpperCase() : marked) + letters.slice(i + 1);
}

/** Tone numbers to tone marks, keeping the spaces and punctuation between syllables. */
export function toMarks(text: string): string {
  if (text.trim() === '') throw new Error('empty');
  return text.replace(/([A-Za-züÜv:]+)([0-5])?/g, (_, letters: string, tone?: string) =>
    markSyllable({
      letters: letters.replace(/u:|v/g, 'ü').replace(/U:|V/g, 'Ü'),
      tone: tone === undefined ? 5 : Number(tone),
    }),
  );
}

export interface Sandhi {
  syllables: Syllable[];
  /** One note for each syllable whose tone changed: its position, the rule, and the tones. */
  changes: { index: number; rule: 'third' | 'yi' | 'bu'; from: number; to: number }[];
}

/**
 * Spoken tones from citation tones: a third tone before another third tone becomes second (taken from right to
 * left within the phrase), yi is second before a fourth tone and fourth before the others, and bu is second
 * before a fourth tone. Yi keeps tone 1 at the end of a phrase.
 */
export function sandhi(text: string): Sandhi {
  const syllables = syllablesOf(text);
  if (syllables.length === 0) throw new Error('empty');
  const out = syllables.map((s) => ({ ...s }));
  const changes: Sandhi['changes'] = [];
  for (let i = 0; i + 1 < out.length; i++) {
    const word = out[i].letters.toLowerCase();
    const next = out[i + 1].tone;
    if (word === 'yi' && out[i].tone === 1 && next !== 5) {
      const to = next === 4 ? 2 : 4;
      changes.push({ index: i, rule: 'yi', from: 1, to });
      out[i].tone = to;
    } else if (word === 'bu' && out[i].tone === 4 && next === 4) {
      changes.push({ index: i, rule: 'bu', from: 4, to: 2 });
      out[i].tone = 2;
    }
  }
  for (let i = out.length - 2; i >= 0; i--) {
    if (out[i].tone === 3 && syllables[i + 1].tone === 3) {
      changes.push({ index: i, rule: 'third', from: 3, to: 2 });
      out[i].tone = 2;
    }
  }
  changes.sort((a, b) => a.index - b.index);
  return { syllables: out, changes };
}
