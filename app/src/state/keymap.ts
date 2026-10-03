// Changing shortcuts (ARCHITECTURE.md section 14.4). Every change is one merge patch of settings.shortcuts, which
// Rust validates and saves. A command's list equal to its shortcut set's own chords removes the override, and
// overrides for commands this version doesn't know are never touched.

import { commands } from '../registries';
import { conflictsFor, hasOverride, keysFor, setKeys } from '../commands/keymap';
import type { Chord, CommandId, KeymapPresetId } from '../commands/types';
import { getSettings, updateSettings } from './settings';

type ShortcutsPatch = Record<string, string[] | null>;

function entry(id: CommandId, chords: readonly Chord[]): ShortcutsPatch {
  const def = commands.get(id);
  if (!def) return {};
  const own = setKeys(def, getSettings().keymap.preset);
  const same = own.length === chords.length && own.every((chord, i) => chord === chords[i]);
  return { [id]: same ? null : [...chords] };
}

/** Sets a command's chords. An empty list leaves it without a shortcut. */
export function setShortcut(id: CommandId, chords: readonly Chord[]): Promise<void> {
  return updateSettings({ shortcuts: entry(id, chords) });
}

/**
 * Makes the chord the command's only shortcut, and takes it from every command that uses it in an overlapping
 * scope, in one change. The shortcut editor asks first when there are any (conflictsFor).
 */
export function assignShortcut(id: CommandId, chord: Chord): Promise<void> {
  const others = conflictsFor(id, chord).map((other) =>
    entry(
      other.id,
      keysFor(other.id).filter((key) => key !== chord),
    ),
  );
  return updateSettings({ shortcuts: Object.assign({}, ...others, entry(id, [chord])) });
}

/** Back to the chosen set's chords. */
export function resetShortcut(id: CommandId): Promise<void> {
  return updateSettings({ shortcuts: { [id]: null } });
}

/** Every command back to the chosen set's chords. Overrides for commands this version doesn't know stay. */
export function resetAllShortcuts(): Promise<void> {
  const changed = commands
    .list()
    .filter((def) => hasOverride(def.id))
    .map((def) => [def.id, null]);
  return changed.length ? updateSettings({ shortcuts: Object.fromEntries(changed) }) : Promise.resolve();
}

/** Chooses the default or the OneNote shortcut set. The person's own changes apply on top of either. */
export function setShortcutSet(preset: KeymapPresetId): Promise<void> {
  return updateSettings({ keymap: { preset } });
}
