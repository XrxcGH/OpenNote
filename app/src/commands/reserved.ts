// Chords that can't become shortcuts (ARCHITECTURE.md section 14.4).
// - Keyboard navigation needs its keys, so they stay free (WCAG 2.1.1 and 2.1.2).
// - Windows owns some chords before the app ever sees them.
// - A chord without Ctrl or Alt that types a character would fire while people type (WCAG 2.1.4), and so would
//   Shift with a printable key. Function keys and named keys such as Delete are fine.

import { parseChord, typesText } from './chords';
import type { Chord, KeyScope } from './types';

export type ChordProblem = 'navigation' | 'windows' | 'typesText';

/** The keys that move around the app: tabbing, regions, menus, lists, and the window menu. */
export const NAVIGATION_CHORDS: readonly string[] = [
  'Tab',
  'Shift+Tab',
  'F6',
  'Shift+F6',
  'Escape',
  'Enter',
  'Space',
  'Shift+F10',
  'Menu',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Alt+Space',
];

/** Chords Windows keeps for itself. Chords with the Windows key can't be written at all. */
export const WINDOWS_CHORDS: readonly string[] = [
  'Alt+F4',
  'Alt+Tab',
  'Alt+Shift+Tab',
  'Ctrl+Alt+Tab',
  'Ctrl+Alt+Delete',
  'Ctrl+Escape',
  'Ctrl+Shift+Escape',
  'Alt+Escape',
  'F10',
];

/**
 * Owner decision D7 (decided with N4 on 2026-11-02): F10 steps over while a debug session is paused, as in VS Code
 * and Visual Studio. The exception is narrow: only in the codeDebug scope, which exists only while paused. Alt still
 * opens the menus.
 */
export const F10_STEPS_OVER_WHILE_PAUSED = true;

/** Why a chord can't be a shortcut in a scope, or null when it can. */
export function chordProblem(chord: Chord, scope?: KeyScope, d7 = F10_STEPS_OVER_WHILE_PAUSED): ChordProblem | null {
  if (d7 && scope === 'codeDebug' && chord === 'F10') return null;
  if (NAVIGATION_CHORDS.includes(chord)) return 'navigation';
  if (WINDOWS_CHORDS.includes(chord)) return 'windows';
  const parts = parseChord(chord);
  return !parts || typesText(parts) ? 'typesText' : null;
}
