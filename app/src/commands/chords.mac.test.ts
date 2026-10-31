import { afterEach, describe, expect, it } from 'vitest';
import { setHostSystem } from '../platform/system';
import { ariaKeyShortcuts, chord, chordMatches, formatChord, primaryChord } from './chords';
import type { KeyInput } from './chords';

afterEach(() => setHostSystem('windows'));

/** A key press as WKWebView reports it on a Mac: `meta` is Command, `alt` is Option, `ctrl` is Control. */
function mac(key: string, code: string, mods = ''): KeyInput {
  return {
    key,
    code,
    ctrlKey: mods.includes('ctrl'),
    altKey: mods.includes('alt'),
    shiftKey: mods.includes('shift'),
    metaKey: mods.includes('meta'),
    isComposing: false,
    getModifierState: () => false,
  };
}

const chords = (event: KeyInput) => chordMatches(event, 'macos').map((match) => `${match.chord} (${match.by})`);

describe('shortcuts on a Mac', () => {
  it('reads Command as the chord modifier', () => {
    expect(chords(mac('s', 'KeyS', 'meta'))).toEqual(['Ctrl+S (key)']);
    expect(chords(mac('D', 'KeyD', 'meta shift'))).toEqual(['Ctrl+Shift+D (key)']);
    expect(primaryChord(mac('!', 'Digit1', 'meta shift'), 'macos')).toBe('Ctrl+Shift+1');
  });

  it('leaves Control to text editing', () => {
    expect(chords(mac('a', 'KeyA', 'ctrl'))).toEqual([]);
    expect(chords(mac('s', 'KeyS', 'ctrl meta'))).toEqual([]);
  });

  it('matches Option chords by the physical key when Option types a symbol', () => {
    // Option+Command+F types "ƒ" on a US Mac keyboard.
    expect(chords(mac('ƒ', 'KeyF', 'meta alt'))).toEqual(['Ctrl+Alt+F (code)']);
    expect(chords(mac('ArrowLeft', 'ArrowLeft', 'alt'))).toEqual(['Alt+Left (key)']);
  });

  it('keeps the Windows reading on Windows, where Command is the Windows key', () => {
    expect(chordMatches(mac('s', 'KeyS', 'meta'), 'windows')).toEqual([]);
    expect(chordMatches(mac('s', 'KeyS', 'ctrl'), 'windows').map((match) => match.chord)).toEqual(['Ctrl+S']);
  });

  it('follows the system set at start when none is passed', () => {
    setHostSystem('macos');
    expect(chordMatches(mac('k', 'KeyK', 'meta')).map((match) => match.chord)).toEqual(['Ctrl+K']);
    expect(formatChord(chord('Ctrl+K'))).toBe('⌘K');
  });
});

describe('reading chords on a Mac', () => {
  it('prints the modifiers as symbols in the order macOS menus use', () => {
    expect(formatChord(chord('Ctrl+Shift+D'), 'macos')).toBe('⇧⌘D');
    expect(formatChord(chord('Ctrl+Alt+Shift+F10'), 'macos')).toBe('⌥⇧⌘F10');
    expect(formatChord(chord('Alt+Left'), 'macos')).toBe('⌥Left');
    expect(formatChord(chord('Ctrl+PageDown'), 'macos')).toBe('⌘Page Down');
    expect(formatChord(chord('F2'), 'macos')).toBe('F2');
  });

  it('names Command as Meta for aria-keyshortcuts', () => {
    expect(ariaKeyShortcuts([chord('Ctrl+Shift+D'), chord('Alt+Left')], 'macos')).toBe('Meta+Shift+D Alt+ArrowLeft');
    expect(ariaKeyShortcuts([chord('Ctrl+Shift+D')], 'linux')).toBe('Control+Shift+D');
  });
});
