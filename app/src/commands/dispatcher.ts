// One capture-phase keydown listener runs shortcuts (ARCHITECTURE.md section 14.3). Chords come from chords.ts,
// which knows the keyboard layout rules; a match by the typed character is tried before one by the physical key.
// - Repeats run only commands that allow them.
// - In a text field, only commands that allow it run.
// - While a modal layer is open, only commands that allow it run.
// - The default is prevented only when a command runs.

import { getLocation } from '../app/location';
import { commands } from '../registries';
import { topLayer } from '../state/layers';
import { chordMatches, primaryChord } from './chords';
import type { KeyInput } from './chords';
import { keysFor } from './keymap';
import { commandContext, executeCommand } from './registry';
import type { Chord, CommandDef, KeyScope } from './types';

/** The chord a key press makes, or null for modifiers alone, text input, and the Windows key. */
export function chordFromEvent(event: KeyInput): Chord | null {
  return primaryChord(event);
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches('input, textarea, select, [contenteditable]');
}

function inScope(scope: KeyScope | undefined, target: EventTarget | null): boolean {
  if (!scope || scope === 'global') return true;
  if (scope === 'workspace') return getLocation().view === 'workspace';
  return target instanceof Element && target.closest(`[data-scope~="${scope}"]`) !== null;
}

// Commands take different argument types; the dispatcher runs them without arguments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runs(def: CommandDef<any>, event: KeyboardEvent, chord: Chord): boolean {
  if (!keysFor(def.id).includes(chord) || !inScope(def.scope, event.target)) return false;
  if (event.repeat && !def.allowRepeat) return false;
  if (isTextInput(event.target) && !def.allowInTextInput) return false;
  if (topLayer()?.modal && !def.allowInModal) return false;
  const ctx = commandContext('keyboard');
  return (!def.when || def.when(ctx)) && (!def.enabled || def.enabled(ctx));
}

/** Listens for shortcuts on the window. Returns a function that stops listening. */
export function installDispatcher(target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    for (const { chord } of chordMatches(event)) {
      const def = commands.list().find((candidate) => runs(candidate, event, chord));
      if (!def) continue;
      event.preventDefault();
      void executeCommand(def.id, undefined, 'keyboard');
      return;
    }
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
