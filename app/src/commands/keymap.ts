// The keymap (ARCHITECTURE.md section 14.4): each command's chords are its overrides in settings.shortcuts,
// else the chords of the chosen shortcut set, else its defaults. WP0 keeps it simple; WP7 adds conflicts and
// layout-aware display names.

import { commands, useRegistry } from '../registries';
import { getSettings, settingsStore } from '../state/settings';
import { shallowEqual, useStore } from '../state/store';
import { t } from '../strings/t';
import type { MessageKey } from '../strings/t';
import { isChordText } from './registry';
import type { Chord, CommandId } from './types';

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

const KEY_NAMES: Record<string, MessageKey> = {
  Ctrl: 'keys.ctrl',
  Alt: 'keys.alt',
  Shift: 'keys.shift',
  Up: 'keys.up',
  Down: 'keys.down',
  Left: 'keys.left',
  Right: 'keys.right',
  Home: 'keys.home',
  End: 'keys.end',
  PageUp: 'keys.pageUp',
  PageDown: 'keys.pageDown',
  Delete: 'keys.delete',
  Backspace: 'keys.backspace',
  Enter: 'keys.enter',
  Escape: 'keys.escape',
  Space: 'keys.space',
  Tab: 'keys.tab',
  Insert: 'keys.insert',
  Menu: 'keys.menu',
};

const ARIA_NAMES: Record<string, string> = {
  Ctrl: 'Control',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Menu: 'ContextMenu',
};

/** "Ctrl+Shift+D", with translated key names. */
export function formatChord(chord: Chord): string {
  return chord
    .split('+')
    .map((part) => (KEY_NAMES[part] ? t(KEY_NAMES[part] as 'keys.ctrl') : part))
    .join('+');
}

/** "Control+Shift+D", for aria-keyshortcuts. Several chords are separated by spaces. */
export function ariaKeyShortcuts(chords: readonly Chord[]): string {
  return chords
    .map((chord) =>
      chord
        .split('+')
        .map((part) => ARIA_NAMES[part] ?? part)
        .join('+'),
    )
    .join(' ');
}

/** The first chord, formatted, or null when the command has none. */
export function shortcutHint(id: CommandId): string | null {
  const [first] = keysFor(id);
  return first ? formatChord(first) : null;
}
