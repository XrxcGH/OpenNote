// The window's spelling engine: one for every page, so the cache outlives a page switch. It starts on first need
// and follows settings.editing.spelling.
import { isEnabled } from '../../../app/flags';
import { commandContext } from '../../../commands/registry';
import type { SpellingService } from '../../../editor/host';
import type { SpellingClient } from '../../../platform/types';
import { getSettings, settingsStore } from '../../../state/settings';
import { createSpellingEngine } from './engine';
import type { SpellingEngine, SpellingRules } from './engine';

let engine: SpellingEngine | null = null;
let client: SpellingClient | null = null;
let stopSettings: (() => void) | null = null;

function rules(): SpellingRules {
  const spelling = getSettings().editing.spelling;
  return {
    enabled: spelling.enabled,
    languages: spelling.languages,
    personalWords: spelling.personalWords,
    ignoreUppercase: spelling.ignoreUppercase,
    ignoreWithDigits: spelling.ignoreWithDigits,
  };
}

function platformClient(): SpellingClient | null {
  try {
    return commandContext('test').platform.spelling;
  } catch {
    return null;
  }
}

/** The engine, started on first call; null while the flag is off or the platform has no spelling. */
export function spellingEngine(): SpellingEngine | null {
  if (!isEnabled('editor.spelling')) return null;
  if (engine) return engine;
  const source = client ?? platformClient();
  if (!source) return null;
  const started = createSpellingEngine(source, rules());
  let last = getSettings().editing.spelling;
  stopSettings = settingsStore.subscribe(() => {
    const next = getSettings().editing.spelling;
    if (next === last) return;
    last = next;
    started.setRules(rules());
  });
  engine = started;
  return engine;
}

/** What the editor host gives editors: the engine while spell check is on. */
export function pageSpelling(): SpellingService | null {
  const current = spellingEngine();
  return current?.active() ? current : null;
}

/** Tests choose the client, and start over. */
export function resetSpelling(next: SpellingClient | null = null): void {
  stopSettings?.();
  stopSettings = null;
  engine?.destroy();
  engine = null;
  client = next;
}
