// Quick capture as the shell keeps it: whether the global shortcut is on and which keys it uses, plus the link to
// Windows pen settings, where the pen top button can be set to open OpenNote.

import { chordFromParts, keyKind } from '../../commands/chords';
import { commandsForChord } from '../../commands/keymap';
import { shellCall } from '../../platform/shellqol';

export interface QuickStatus {
  readonly choice: { readonly enabled: boolean; readonly key: string };
  /** False when another program already holds the keys. */
  readonly registered: boolean;
}

/**
 * Off until the person turns it on, so no key is taken from other programs unasked. The default uses the Windows key:
 * Windows delivers AltGr as Ctrl+Alt, so a Ctrl+Alt letter would fire on an AltGr character in every program.
 * src-tauri/src/shellqol/quick.rs keeps the same rules.
 */
export const DEFAULT_QUICK: QuickStatus = { choice: { enabled: false, key: 'Win+Shift+Q' }, registered: false };

interface GlobalKey {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  win: boolean;
  /** A letter A to Z, a digit, or F1 to F24. */
  key: string;
}

function parseGlobalKey(text: string): GlobalKey | null {
  const out: GlobalKey = { ctrl: false, alt: false, shift: false, win: false, key: '' };
  for (const part of text.split('+').map((piece) => piece.trim().toLowerCase())) {
    if (part === 'ctrl' || part === 'control') out.ctrl = true;
    else if (part === 'alt') out.alt = true;
    else if (part === 'shift') out.shift = true;
    else if (part === 'win' || part === 'meta') out.win = true;
    else if (out.key !== '') return null;
    else out.key = part.toUpperCase();
  }
  const kind = keyKind(out.key);
  const usable = kind === 'letter' || kind === 'digit' || kind === 'function';
  return usable && (out.ctrl || out.alt || out.win) ? out : null;
}

/**
 * Why a shortcut can't be the quick capture key: 'invalid' when it isn't Ctrl, Alt, or the Windows key with a
 * letter, digit, or F key, and 'altgr' for Ctrl+Alt with a letter or digit and no Windows key, which AltGr presses
 * too. Null when it can be used.
 */
export function quickKeyProblem(text: string): 'invalid' | 'altgr' | null {
  const parsed = parseGlobalKey(text);
  if (!parsed) return 'invalid';
  const types = keyKind(parsed.key) !== 'function';
  return parsed.ctrl && parsed.alt && !parsed.win && types ? 'altgr' : null;
}

/** The OpenNote commands bound to the same keys, which the global shortcut would take over inside OpenNote too. */
export function quickKeyClashes(text: string): string[] {
  const parsed = parseGlobalKey(text);
  if (!parsed || parsed.win) return [];
  return commandsForChord(chordFromParts(parsed)).map((command) => command.id);
}

export async function quickStatus(): Promise<QuickStatus> {
  return (await shellCall<QuickStatus | null>('quick.status').catch(() => null)) ?? DEFAULT_QUICK;
}

export async function setQuick(enabled: boolean, key: string): Promise<QuickStatus> {
  return (await shellCall<QuickStatus | null>('quick.set', { enabled, key })) ?? DEFAULT_QUICK;
}

export function openQuickCapture(): Promise<unknown> {
  return shellCall('quick.open');
}

/** Opens Windows settings on the pen page. */
export function openPenSettings(): Promise<unknown> {
  return shellCall('window.openPenSettings').catch(() => undefined);
}
