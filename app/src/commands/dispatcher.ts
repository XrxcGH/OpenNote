// One capture-phase keydown listener runs shortcuts (ARCHITECTURE.md section 14.3). This WP0 version matches
// letters by the typed key (by the physical key on non-Latin layouts), digits by the physical key, and the rest
// by the typed key. WP7 replaces it with layout-aware matching and reserved keys, keeping these rules:
// - Repeats run only commands that allow them.
// - In a text field, only commands that allow it run.
// - While a modal layer is open, only commands that allow it run.
// - The default is prevented only when a command runs.

import { getLocation } from '../app/location';
import { commands } from '../registries';
import { topLayer } from '../state/layers';
import { keysFor } from './keymap';
import { commandContext, executeCommand } from './registry';
import type { Chord, CommandDef, KeyScope } from './types';

const NAMED: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Enter: 'Enter',
  Escape: 'Escape',
  ' ': 'Space',
  Tab: 'Tab',
  Insert: 'Insert',
  ContextMenu: 'Menu',
};

function keyName(event: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  const { key, code } = event;
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^Key[A-Z]$/.test(code) && !/^[\x20-\x7e]$/.test(key)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (NAMED[key]) return NAMED[key];
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(key) || /^[/\\,.;'`=[\]-]$/.test(key)) return key;
  return null;
}

type ChordKeys = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'isComposing'> & {
  getModifierState?: (key: string) => boolean;
};

/** The chord a key press makes, or null for modifiers alone, text input, and the Windows key. */
export function chordFromEvent(event: ChordKeys): Chord | null {
  if (event.isComposing || event.key === 'Process' || event.metaKey) return null;
  if (event.getModifierState?.('AltGraph')) return null;
  const key = keyName(event);
  if (!key) return null;
  const parts = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', key];
  return parts.filter(Boolean).join('+') as Chord;
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
    const chord = chordFromEvent(event);
    if (!chord) return;
    const def = commands.list().find((candidate) => runs(candidate, event, chord));
    if (!def) return;
    event.preventDefault();
    void executeCommand(def.id, undefined, 'keyboard');
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
