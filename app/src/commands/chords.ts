// Chords (ARCHITECTURE.md section 14.2): the canonical text form, how a key press becomes chords on any keyboard
// layout, and how chords read for people and for aria-keyshortcuts.
//
// The canonical form is "Ctrl+Alt+Shift+Key": modifiers in that order, then one key. Letters are A to Z, digits
// 0 to 9, punctuation is the character itself, stored without Shift (Ctrl+Shift+= on a US keyboard is Ctrl++),
// and named keys use the names below. The Windows key is never part of a chord.
//
// A key press can match two chords: one by the typed character (event.key), tried first, and one by the
// physical key (event.code), tried second (Phase 4 P2-3).
//
// - Letters match the typed letter. Only a non-Latin letter falls back to the physical key.
// - Digits always match the physical key, so Ctrl+Shift+1 works whatever Shift types.
// - Punctuation matches the typed character, with Shift ignored. Only a dead key falls back to its physical key,
//   so Ctrl+- on a German keyboard can't match Ctrl+/ through its Slash code.
// - AltGr types text. While it's down, only a Ctrl+Alt chord whose key is the typed character matches.
// - Nothing matches during input method composition.

import { t } from '../strings/t';
import type { MessageKey } from '../strings/t';
import type { Chord } from './types';

export const MODIFIERS = ['Ctrl', 'Alt', 'Shift'] as const;
export type Modifier = (typeof MODIFIERS)[number];

export const NAMED_KEYS: readonly string[] =
  'Up Down Left Right Home End PageUp PageDown Delete Backspace Enter Escape Space Tab Insert Menu'.split(' ');

/** Printable ASCII other than letters, digits, and the space. */
const PUNCTUATION = new Set([...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~']);
const FUNCTION_KEY = /^F(?:[1-9]|1\d|2[0-4])$/;
const PRINTABLE_ASCII = /^[\x21-\x7e]$/;

export type KeyKind = 'letter' | 'digit' | 'punctuation' | 'function' | 'named';

export function keyKind(key: string): KeyKind | null {
  if (/^[A-Z]$/.test(key)) return 'letter';
  if (/^\d$/.test(key)) return 'digit';
  if (PUNCTUATION.has(key)) return 'punctuation';
  if (FUNCTION_KEY.test(key)) return 'function';
  return NAMED_KEYS.includes(key) ? 'named' : null;
}

export interface ChordParts {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly key: string;
}

function split(text: string): { modifiers: string[]; key: string } {
  if (text === '+') return { modifiers: [], key: '+' };
  if (text.endsWith('++')) return { modifiers: text.slice(0, -2).split('+'), key: '+' };
  const parts = text.split('+');
  const key = parts.pop() ?? '';
  return { modifiers: parts, key };
}

/** The parts of a chord in the canonical form, or null for anything else. */
export function parseChord(text: string): ChordParts | null {
  const { modifiers, key } = split(text);
  const order = modifiers.map((part) => MODIFIERS.indexOf(part as Modifier));
  if (order.some((index, i) => index < 0 || (i > 0 && index <= order[i - 1]))) return null;
  const kind = keyKind(key);
  const shift = modifiers.includes('Shift');
  if (!kind || (kind === 'punctuation' && shift)) return null;
  return { ctrl: modifiers.includes('Ctrl'), alt: modifiers.includes('Alt'), shift, key };
}

/** Checks the canonical form: modifiers in the order Ctrl, Alt, Shift, each at most once, then one key. */
export function isChordText(text: string): boolean {
  return parseChord(text) !== null;
}

/** A chord in the canonical form, such as 'Ctrl+Shift+D'. Throws on anything else. */
export function chord(text: string): Chord {
  if (!isChordText(text)) throw new Error(`"${text}" isn't a chord in the form Ctrl+Alt+Shift+Key.`);
  return text as Chord;
}

export function chordFromParts(parts: ChordParts): Chord {
  const shift = parts.shift && keyKind(parts.key) !== 'punctuation';
  return [parts.ctrl && 'Ctrl', parts.alt && 'Alt', shift && 'Shift', parts.key].filter(Boolean).join('+') as Chord;
}

/** Whether a chord types text on its own: a printable key without Ctrl and without Alt. */
export function typesText(parts: ChordParts): boolean {
  const kind = keyKind(parts.key);
  const printable = kind === 'letter' || kind === 'digit' || kind === 'punctuation' || parts.key === 'Space';
  return printable && !parts.ctrl && !parts.alt;
}

// ---- Key presses

/** The KeyboardEvent fields matching needs, so tests can replay recorded events. */
export interface KeyInput {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing?: boolean;
  getModifierState?(key: string): boolean;
}

export interface ChordMatch {
  readonly chord: Chord;
  /** 'key' when the typed character names the key, 'code' when only the physical key does. */
  readonly by: 'key' | 'code';
}

/** event.key values of named keys; the rest use their own names. */
const EVENT_NAMES: Record<string, string> = {
  ...Object.fromEntries(NAMED_KEYS.map((name) => [name, name])),
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
  ContextMenu: 'Menu',
};

/** The US character of each punctuation key, for keys that type nothing printable on this layout. */
const CODE_PUNCTUATION: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

type Modifiers = Pick<ChordParts, 'ctrl' | 'alt' | 'shift'>;

/** The chord the typed character names, if it names one. */
function byTypedKey(key: string, mods: Modifiers): Chord | null {
  const named = Object.hasOwn(EVENT_NAMES, key) ? EVENT_NAMES[key] : FUNCTION_KEY.test(key) ? key : null;
  if (named) return chordFromParts({ ...mods, key: named });
  if (/^[a-z]$/i.test(key)) return chordFromParts({ ...mods, key: key.toUpperCase() });
  if (/^\d$/.test(key) || PUNCTUATION.has(key)) return chordFromParts({ ...mods, key });
  return null;
}

/** The chord the physical key names. Digits always count; other keys count only when nothing printable was typed. */
function byPhysicalKey(event: KeyInput, mods: Modifiers): Chord | null {
  const digit = /^Digit(\d)$/.exec(event.code)?.[1];
  if (digit) return chordFromParts({ ...mods, key: digit });
  if (PRINTABLE_ASCII.test(event.key)) return null;
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  if (letter) return chordFromParts({ ...mods, key: letter });
  const punctuation = CODE_PUNCTUATION[event.code];
  return punctuation && !mods.shift ? chordFromParts({ ...mods, key: punctuation }) : null;
}

/**
 * Every chord a key press matches, best first: the match by the typed character, then the one by the physical
 * key. Empty for modifiers alone, the Windows key, input method composition, and AltGr text.
 */
export function chordMatches(event: KeyInput): ChordMatch[] {
  if (event.isComposing || event.key === 'Process' || event.metaKey) return [];
  const altGraph = event.getModifierState?.('AltGraph') ?? false;
  const mods = { ctrl: event.ctrlKey || altGraph, alt: event.altKey || altGraph, shift: event.shiftKey };
  const typed = byTypedKey(event.key, mods);
  const matches: ChordMatch[] = typed ? [{ chord: typed, by: 'key' }] : [];
  if (altGraph) return matches;
  const physical = byPhysicalKey(event, mods);
  if (physical && physical !== typed) matches.push({ chord: physical, by: 'code' });
  return matches;
}

/**
 * The one chord that names a key press, as the shortcut editor stores it. A digit key gives its digit, so
 * Ctrl+Shift+1 stays Ctrl+Shift+1 on every layout. Other keys give the best match, or null.
 */
export function primaryChord(event: KeyInput): Chord | null {
  const matches = chordMatches(event);
  const isDigit = (match: ChordMatch) => keyKind(split(match.chord).key) === 'digit';
  const digit = /^Digit\d$/.test(event.code) ? matches.find(isDigit) : undefined;
  return (digit ?? matches[0])?.chord ?? null;
}

// ---- Reading chords

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
  '+': 'keys.plus',
};

const ARIA_NAMES: Record<string, string> = {
  Ctrl: 'Control',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Menu: 'ContextMenu',
  '+': 'Plus',
};

let layout: ReadonlyMap<string, string> | null = null;

/** Uses the keyboard layout's printed keys for display. Tests pass a map; null goes back to the chord's names. */
export function setKeyboardLayout(map: ReadonlyMap<string, string> | null): void {
  layout = map;
}

interface LayoutNavigator {
  keyboard?: { getLayoutMap?(): Promise<ReadonlyMap<string, string>> };
}

/** Reads the printed keys of this keyboard where the browser offers them, as WebView2 does. */
export async function loadKeyboardLayout(nav: object | undefined = globalThis.navigator): Promise<void> {
  try {
    const map = await (nav as LayoutNavigator | undefined)?.keyboard?.getLayoutMap?.();
    if (map) setKeyboardLayout(new Map(map));
  } catch {
    // Some hosts refuse the layout map; the chord's own names still read correctly.
  }
}

/**
 * The key as printed on this keyboard. Digits match the physical key, so a digit chord without Shift shows the
 * character that key types here. On a French keyboard, Ctrl+0 reads "Ctrl+à", the key the person presses.
 */
function printedKey(parts: ChordParts): string {
  if (keyKind(parts.key) !== 'digit' || parts.shift) return parts.key;
  const printed = layout?.get(`Digit${parts.key}`);
  return printed && [...printed].length === 1 && printed !== parts.key ? printed : parts.key;
}

function names(parts: ChordParts, key: string): string[] {
  return [parts.ctrl && 'Ctrl', parts.alt && 'Alt', parts.shift && 'Shift', key].filter(
    (name): name is string => typeof name === 'string',
  );
}

/** "Ctrl+Shift+D", with translated key names and the key as printed on this keyboard. */
export function formatChord(text: Chord): string {
  const parts = parseChord(text);
  if (!parts) return text;
  return names(parts, printedKey(parts))
    .map((name) => (KEY_NAMES[name] ? t(KEY_NAMES[name] as 'keys.ctrl') : name))
    .join('+');
}

/** "Control+Shift+D", for aria-keyshortcuts. Several chords are separated by spaces. */
export function ariaKeyShortcuts(chords: readonly Chord[]): string {
  return chords
    .map((text) => {
      const parts = parseChord(text);
      return parts
        ? names(parts, parts.key)
            .map((name) => ARIA_NAMES[name] ?? name)
            .join('+')
        : text;
    })
    .join(' ');
}
