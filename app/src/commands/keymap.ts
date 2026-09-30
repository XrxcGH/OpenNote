// The keymap (ARCHITECTURE.md section 14.4): each command's chords are its overrides in settings.shortcuts,
// else the chords of the chosen shortcut set, else its defaults. WP0 keeps it simple; WP7 adds conflicts and
// layout-aware display names.

import { commands, useRegistry } from '../registries';
import { getSettings, settingsStore } from '../state/settings';
import { shallowEqual, useStore } from '../state/store';
import { formatChord, isChordText } from './chords';
import type { Chord, CommandId } from './types';

export { ariaKeyShortcuts, formatChord } from './chords';

export function keysFor(id: CommandId): readonly Chord[] {
  const def = commands.get(id);
  if (!def) return [];
  const settings = getSettings();
  const override = settings.shortcuts[id];
  if (override) return override.filter(isChordText) as Chord[];
  return def.presetKeys?.[settings.keymap.preset] ?? def.keys ?? [];
}

/** keysFor as a hook: follows rebinding and newly registered commands. */
export function useKeysFor(id: CommandId): readonly Chord[] {
  useRegistry(commands);
  return useStore(settingsStore, () => keysFor(id), shallowEqual);
}

/** The first chord, formatted, or null when the command has none. */
export function shortcutHint(id: CommandId): string | null {
  const [first] = keysFor(id);
  return first ? formatChord(first) : null;
}
