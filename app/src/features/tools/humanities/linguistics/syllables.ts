// Syllables by sonority with the onset as long as it can be. Each vowel is a nucleus. The consonants between two
// nuclei go to the following onset as far as a legal onset allows, and the rest close the syllable before. Legal
// onsets are the student's typed list; without one, an onset must rise in sonority toward the vowel.
import { featuresOf, segments } from './features';
import type { Inventory } from './features';

/** Sonority from 1 (stops) to 7 (vowels), from the segment's features. */
export function sonority(segment: string, inventory: Inventory): number {
  const f = featuresOf(segment, inventory);
  if (!f) throw new Error('unknownSegment');
  if (f.syl === '+') return 7;
  if (f.cons === '-' && f.son === '+') return 6;
  if (f.son === '+' && f.nas === '-') return 5;
  if (f.nas === '+') return 4;
  if (f.cont === '+') return 3;
  if (f.delrel === '+') return 2;
  return 1;
}

export interface Syllabified {
  syllables: string[][];
  /** For each cluster between two nuclei, how it was split. */
  splits: { cluster: string; onset: string; coda: string }[];
}

function rising(onset: readonly string[], inventory: Inventory): boolean {
  for (let i = 1; i < onset.length; i++) {
    if (sonority(onset[i], inventory) <= sonority(onset[i - 1], inventory)) return false;
  }
  return true;
}

/** Splits a word into syllables. Legal onsets are written with spaces or commas between them, such as "p, n, d". */
export function syllabify(word: string, legalOnsets: string, inventory: Inventory): Syllabified {
  const segs = segments(word, inventory);
  if (segs.length === 0) throw new Error('empty');
  const nuclei = segs.map((s, i) => (sonority(s, inventory) === 7 ? i : -1)).filter((i) => i >= 0);
  if (nuclei.length === 0) throw new Error('noVowel');
  const list = legalOnsets
    .split(/[,;\n]/)
    .map((o) => segments(o.trim(), inventory).join(''))
    .filter(Boolean);
  const legal = (onset: readonly string[]) =>
    onset.length === 0 || (list.length > 0 ? list.includes(onset.join('')) : rising(onset, inventory));
  const bounds: number[] = [0];
  const splits: Syllabified['splits'] = [];
  for (let k = 1; k < nuclei.length; k++) {
    const from = nuclei[k - 1] + 1;
    const to = nuclei[k];
    const cluster = segs.slice(from, to);
    let start = from;
    while (start < to && !legal(segs.slice(start, to))) start++;
    bounds.push(start);
    splits.push({
      cluster: cluster.join(''),
      onset: segs.slice(start, to).join(''),
      coda: segs.slice(from, start).join(''),
    });
  }
  bounds.push(segs.length);
  const syllables = bounds.slice(0, -1).map((b, i) => segs.slice(b, bounds[i + 1]));
  return { syllables, splits };
}
