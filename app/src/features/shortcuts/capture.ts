// What the shortcut editor does with a key press (ARCHITECTURE.md sections 14.4 and 14.7): which key presses are
// only modifiers, and whether a chord can become a command's shortcut.

import { conflictsFor } from '../../commands/keymap';
import type { AnyCommand } from '../../commands/keymap';
import { chordProblem } from '../../commands/reserved';
import type { ChordProblem } from '../../commands/reserved';
import { primaryChord } from '../../commands/chords';
import type { KeyInput } from '../../commands/chords';
import type { Chord, CommandId } from '../../commands/types';

/** Keys that change what another key means, or toggle a state. Pressing one alone isn't an answer yet. */
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock']);

export const isModifierKey = (key: string): boolean => MODIFIER_KEYS.has(key);

export type Verdict =
  | { readonly kind: 'ok' }
  | { readonly kind: 'problem'; readonly problem: ChordProblem }
  | { readonly kind: 'conflict'; readonly others: readonly AnyCommand[] };

/** Whether `chord` can be the shortcut of command `id`: free, not allowed, or already used in an overlapping scope. */
export function checkChord(id: CommandId, chord: Chord): Verdict {
  const problem = chordProblem(chord);
  if (problem) return { kind: 'problem', problem };
  const others = conflictsFor(id, chord);
  return others.length ? { kind: 'conflict', others } : { kind: 'ok' };
}

/** What a key press means to a field that is listening for a shortcut. */
export type Heard =
  | { readonly kind: 'ignore' }
  | { readonly kind: 'remove' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'chord'; readonly chord: Chord };

/** Modifiers alone and keys that leave the field are ignored, Backspace removes, and anything else is a chord. */
export function hear(event: KeyInput): Heard {
  if (event.isComposing || event.key === 'Tab' || event.key === 'Escape' || isModifierKey(event.key)) {
    return { kind: 'ignore' };
  }
  const plain = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
  if (event.key === 'Backspace' && plain) return { kind: 'remove' };
  const chord = primaryChord(event);
  return chord ? { kind: 'chord', chord } : { kind: 'unknown' };
}
