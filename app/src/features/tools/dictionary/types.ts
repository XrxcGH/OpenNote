// The dictionary's data and what a look-up gives back. The data is a set of chunks, one for each first letter, so a
// word loads only its own letter. A chunk maps a word to its parts of speech, and each part of speech to its senses in
// the order people meet them: the most common first. The same shape is made from WordNet's database files by
// app/scripts/dictionary/wordnet.ts, and by the dictionary files a person adds for another language.

/** Noun, verb, adjective, or adverb. */
export type Pos = 'n' | 'v' | 'a' | 'r';
export const POS_LIST: readonly Pos[] = ['n', 'v', 'a', 'r'];

/** A sense: what it means, other words with the same meaning, and a line that uses it (when one is known). */
export type Sense = readonly [definition: string, synonyms: readonly string[], example?: string];

export type PosEntry = readonly [pos: Pos, senses: readonly Sense[]];

/** The words that start with one letter. */
export type Chunk = Readonly<Record<string, readonly PosEntry[]>>;

/** Gives the chunk for a letter, or null when there is none. */
export type ChunkLoader = (letter: string) => Promise<Chunk | null>;

export interface Meaning {
  pos: Pos;
  senses: readonly { definition: string; synonyms: readonly string[]; example: string | null }[];
}

export interface Lookup {
  /** The word as it was asked for, cleaned up. */
  query: string;
  /** The word found: the query itself, or its base form when the query was inflected ("running" finds "run"). */
  word: string;
  meanings: readonly Meaning[];
  /** Every synonym of every sense, once each, with the most common senses first. */
  synonyms: readonly string[];
}
