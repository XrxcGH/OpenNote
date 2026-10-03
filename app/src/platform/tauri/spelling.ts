// The Windows Spell Checking API through the shell (owner after WP0: WP7).
import type { SpellingClient } from '../types';
import { invoke } from './invoke';

export function createTauriSpelling(): SpellingClient {
  return {
    languages: () => invoke('spell_languages'),
    check: (items, languages) => invoke('spell_check', { items, languages }),
    suggest: (word, languages) => invoke('spell_suggest', { word, languages }),
    addWord: (word) => invoke('spell_add_word', { word }).then(() => undefined),
    removeWord: (word) => invoke('spell_remove_word', { word }).then(() => undefined),
  };
}
