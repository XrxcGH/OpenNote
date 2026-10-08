// Looking a word up: the word is cleaned, its chunk is loaded by first letter, and the entry is found as typed or, for
// an inflected form, by its base form. Nothing here touches the network or the page.
import { baseForms } from './morphy';
import { POS_LIST } from './types';
import type { Chunk, ChunkLoader, Lookup, Meaning, PosEntry } from './types';

/** The word without the marks around it: no spaces or punctuation at the ends, lowercase, one space between words. */
export function cleanWord(text: string): string {
  return text
    .normalize('NFC')
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

/** The chunk a word lives in: its first letter, or an underscore for a word that starts with anything else. */
export function chunkKey(word: string): string {
  const first = word.normalize('NFD').charAt(0);
  return /^[a-z]$/.test(first) ? first : '_';
}

function meaningsOf(entries: readonly PosEntry[]): Meaning[] {
  return [...entries]
    .sort((a, b) => POS_LIST.indexOf(a[0]) - POS_LIST.indexOf(b[0]))
    .map(([pos, senses]) => ({
      pos,
      senses: senses.map(([definition, synonyms, example]) => ({
        definition,
        synonyms,
        example: example ?? null,
      })),
    }));
}

/** Every synonym once, in the order the senses list them, without the word itself. */
export function synonymsOf(word: string, meanings: readonly Meaning[]): string[] {
  const seen = new Set<string>([word]);
  const out: string[] = [];
  for (const meaning of meanings) {
    for (const sense of meaning.senses) {
      for (const synonym of sense.synonyms) {
        if (!seen.has(synonym.toLocaleLowerCase())) {
          seen.add(synonym.toLocaleLowerCase());
          out.push(synonym);
        }
      }
    }
  }
  return out;
}

/** Looks the word up with the loader's data. Null when the dictionary does not have it. */
export async function lookupWord(text: string, load: ChunkLoader): Promise<Lookup | null> {
  const query = cleanWord(text);
  if (query === '') return null;
  const chunks = new Map<string, Chunk | null>();
  const chunkOf = async (word: string): Promise<Chunk | null> => {
    const key = chunkKey(word);
    if (!chunks.has(key)) chunks.set(key, await load(key));
    return chunks.get(key) ?? null;
  };
  // A phrase that is not in the dictionary is tried by its first word, which is the one that was meant when a selection
  // runs past it.
  const asked = query.includes(' ') ? [query, query.split(' ')[0]] : [query];
  for (const phrase of asked) {
    for (const candidate of [phrase, ...baseForms(phrase)]) {
      const entries = Object.hasOwn((await chunkOf(candidate)) ?? {}, candidate)
        ? (await chunkOf(candidate))?.[candidate]
        : undefined;
      if (entries && entries.length > 0) {
        const meanings = meaningsOf(entries);
        return { query, word: candidate, meanings, synonyms: synonymsOf(candidate, meanings) };
      }
    }
  }
  return null;
}
