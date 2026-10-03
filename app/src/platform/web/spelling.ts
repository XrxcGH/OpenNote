// The web platform's spelling (owner after WP0: WP7): a short list of common misspellings stands in for Windows'
// dictionaries, so the interface and its tests run in a browser. Words people add are never errors.
import type { SpellingClient } from '../types';

const MISSPELLED: Readonly<Record<string, string[]>> = {
  teh: ['the'],
  recieve: ['receive'],
  seperate: ['separate'],
  definately: ['definitely'],
  occured: ['occurred'],
  untill: ['until'],
  wich: ['which'],
  becuase: ['because'],
  freind: ['friend'],
  tommorow: ['tomorrow'],
};

export function createWebSpelling(): SpellingClient {
  const added = new Set<string>();
  const wrong = (word: string) => word.toLowerCase() in MISSPELLED && !added.has(word.toLowerCase());
  return {
    languages: () => Promise.resolve([{ tag: 'en-US', name: 'English (United States)', isDefault: true }]),
    check: (items) =>
      Promise.resolve(
        items.map(({ id, text }) => ({
          id,
          errors: [...text.matchAll(/\p{L}+/gu)]
            .filter((match) => wrong(match[0]))
            .map((match) => ({ start: match.index, length: match[0].length })),
        })),
      ),
    suggest: (word) => Promise.resolve(MISSPELLED[word.toLowerCase()] ?? []),
    addWord: (word) => {
      added.add(word.toLowerCase());
      return Promise.resolve();
    },
    removeWord: (word) => {
      added.delete(word.toLowerCase());
      return Promise.resolve();
    },
  };
}
