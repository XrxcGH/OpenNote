// The English data that comes with the app: one chunk for each first letter, loaded when a word starts with it. The
// chunks are made from WordNet's database by app/scripts/dictionary/wordnet.ts. What is bundled now is a starter set of
// common study words in the same shape (see the README of this folder).
import type { Chunk, ChunkLoader } from './types';

const chunks = import.meta.glob<Chunk>('./data/en/*.json', { import: 'default' });

export const englishLoader: ChunkLoader = async (key) => {
  const load = chunks[`./data/en/${key}.json`];
  return load ? load() : null;
};
