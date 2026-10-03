// One capture-phase keydown listener runs every shortcut (ARCHITECTURE.md section 14.3).
//
// 1. A key press gives its chords, the match by the typed character first (chords.ts).
// 2. The active scopes come from the focused element's data-scope attributes and the view.
// 3. The most specific command wins. One whose `when` or `enabled` is false lets the key go on.
// 4. Text fields take only chords with Ctrl or Alt, or function keys, and keep their own editing chords.
// 5. While a modal layer is open, only commands that allow it run, and those of the layer's own scope.
// 6. Held keys repeat only commands that allow it. The default is prevented only when a command runs.

import { isEnabled } from '../app/flags';
import { getLocation } from '../app/location';
import { topLayer } from '../state/layers';
import { chordMatches, keyKind, loadKeyboardLayout, parseChord, primaryChord } from './chords';
import type { KeyInput } from './chords';
import { SCOPE_PARENT, commandsForChord, scopeDepth } from './keymap';
import type { AnyCommand } from './keymap';
import { commandContext, executeCommand } from './registry';
import type { Chord, KeyScope } from './types';

/** The chord a key press makes, or null for modifiers alone, text input, and the Windows key. */
export function chordFromEvent(event: KeyInput): Chord | null {
  return primaryChord(event);
}

const TEXT_INPUT =
  'textarea, select, [contenteditable]:not([contenteditable="false"]), ' +
  'input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="range"])';

export function isTextInput(element: Element | null): boolean {
  return element?.matches(TEXT_INPUT) ?? false;
}

const TEXT_FIELD_KEYS = new Set(['A', 'C', 'V', 'X', 'Z', 'Y', 'Backspace', 'Delete', 'Left', 'Right', 'Up', 'Down']);

/**
 * Whether a chord can reach commands from a text field. It needs Ctrl or Alt, or a function key. Text fields
 * keep their own editing chords, such as Ctrl+A, Ctrl+C, Ctrl+Z, and Ctrl+Left, with or without Shift.
 */
export function reachesCommandsInText(chord: Chord): boolean {
  const parts = parseChord(chord);
  if (!parts) return false;
  if (keyKind(parts.key) === 'function') return true;
  if (parts.ctrl && !parts.alt && TEXT_FIELD_KEYS.has(parts.key)) return false;
  return parts.ctrl || parts.alt;
}

const VIEWS_WITH_WORKSPACE = new Set(['workspace', 'trash']);
const MODAL_SCOPES = new Set<KeyScope>(['palette', 'dialog']);

/** The scopes active for a focused element: global, the workspace while it shows, and every data-scope around it. */
export function activeScopes(element: Element | null, view: string = getLocation().view): Set<KeyScope> {
  const scopes = new Set<KeyScope>(['global']);
  if (VIEWS_WITH_WORKSPACE.has(view)) scopes.add('workspace');
  for (let at = element?.closest('[data-scope]'); at; at = at.parentElement?.closest('[data-scope]')) {
    for (const token of (at.getAttribute('data-scope') ?? '').split(/\s+/)) {
      if (token in SCOPE_PARENT) scopes.add(token as KeyScope);
    }
  }
  if (!scopes.has('palette') && element?.closest('[role="dialog"], dialog')) scopes.add('dialog');
  return scopes;
}

function bySpecificity(a: AnyCommand, b: AnyCommand): number {
  const depth = scopeDepth(b.scope) - scopeDepth(a.scope);
  if (depth !== 0) return depth;
  return a.refines === b.id ? -1 : b.refines === a.id ? 1 : 0;
}

interface Press {
  readonly target: Element | null;
  readonly repeat: boolean;
}

function allowed(def: AnyCommand, press: Press, textInput: boolean): boolean {
  if (press.repeat && !def.allowRepeat) return false;
  if (textInput && !def.allowInTextInput) return false;
  if (topLayer()?.modal && !def.allowInModal && !MODAL_SCOPES.has(def.scope ?? 'global')) return false;
  const ctx = commandContext('keyboard');
  return (!def.when || def.when(ctx)) && (!def.enabled || def.enabled(ctx));
}

/** The command a key press runs, or null. Key-capture fields, such as the shortcut editor's, get every key. */
export function commandForKey(event: KeyInput & Press): AnyCommand | null {
  const { target } = event;
  if (target?.closest('[data-key-capture]')) return null;
  const scopes = activeScopes(target);
  const textInput = isTextInput(target);
  for (const { chord } of chordMatches(event)) {
    if (textInput && !reachesCommandsInText(chord)) continue;
    const candidates = commandsForChord(chord)
      .filter((def) => (!def.flag || isEnabled(def.flag)) && scopes.has(def.scope ?? 'global'))
      .sort(bySpecificity);
    const def = candidates.find((candidate) => allowed(candidate, event, textInput));
    if (def) return def;
  }
  return null;
}

function pressOf(event: KeyboardEvent, target: Element | null): KeyInput & Press {
  const { key, code, ctrlKey, altKey, shiftKey, metaKey, isComposing, repeat } = event;
  const getModifierState = (name: string) => event.getModifierState(name);
  return { key, code, ctrlKey, altKey, shiftKey, metaKey, isComposing, repeat, getModifierState, target };
}

/** Listens for shortcuts on the window. Returns a function that stops listening. */
export function installDispatcher(target: Window = window): () => void {
  void loadKeyboardLayout(target.navigator);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const focused = event.target instanceof Element ? event.target : target.document.activeElement;
    const def = commandForKey(pressOf(event, focused));
    if (!def) return;
    event.preventDefault();
    void executeCommand(def.id, undefined, 'keyboard');
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
