import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MODIFIERS,
  NAMED_KEYS,
  ariaKeyShortcuts,
  chord,
  chordFromParts,
  chordMatches,
  formatChord,
  isChordText,
  loadKeyboardLayout,
  parseChord,
  primaryChord,
  setKeyboardLayout,
} from './chords';
import type { KeyInput } from './chords';

afterEach(() => setKeyboardLayout(null));

/** A key press as Chromium reports it on Windows. `altGraph` is what getModifierState('AltGraph') returns. */
function press(key: string, code: string, mods: string = '', altGraph = false): KeyInput {
  return {
    key,
    code,
    ctrlKey: mods.includes('ctrl') || altGraph,
    altKey: mods.includes('alt') || altGraph,
    shiftKey: mods.includes('shift'),
    metaKey: mods.includes('meta'),
    isComposing: false,
    getModifierState: (name) => name === 'AltGraph' && altGraph,
  };
}

const chords = (event: KeyInput) => chordMatches(event).map((match) => `${match.chord} (${match.by})`);

const CANONICAL = ['Ctrl+Shift+D', 'Ctrl+Alt+Shift+F10', 'Ctrl+/', 'Alt+Left', 'F2', 'Delete', 'Ctrl++', 'Ctrl+?'];
const NOT_CANONICAL = ['Shift+Ctrl+D', 'Ctrl+Ctrl+D', 'Win+D', 'Ctrl+', 'Ctrl+d', '', '++', 'Ctrl+Shift+/', 'Ctrl+Ä'];

describe('the canonical form', () => {
  it('accepts modifiers in order and one key', () => {
    expect(CANONICAL.filter((text) => !isChordText(text))).toEqual([]);
  });

  it('rejects other orders, repeats, unknown keys, and Shift with punctuation', () => {
    expect(NOT_CANONICAL.filter((text) => isChordText(text))).toEqual([]);
    expect(() => chord('Meta+K')).toThrow();
  });

  it('parses the plus key', () => {
    expect(parseChord('Ctrl++')).toEqual({ ctrl: true, alt: false, shift: false, key: '+' });
    expect(parseChord('+')).toEqual({ ctrl: false, alt: false, shift: false, key: '+' });
  });

  it('round-trips every chord through its parts', () => {
    const key = fc.oneof(
      fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'),
      fc.constantFrom(...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'),
      fc.constantFrom(...NAMED_KEYS),
      fc.integer({ min: 1, max: 24 }).map((n) => `F${n}`),
    );
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.boolean(), key, (ctrl, alt, shift, k) => {
        const text = chordFromParts({ ctrl, alt, shift, key: k });
        const parts = parseChord(text);
        expect(parts).not.toBeNull();
        expect(chordFromParts(parts!)).toBe(text);
        expect(formatChord(text).split('+').length).toBeLessThanOrEqual(MODIFIERS.length + 2);
      }),
      { numRuns: 300 },
    );
  });
});

describe('key presses on a US keyboard', () => {
  it('reads letters, digits, and punctuation', () => {
    expect(chords(press('k', 'KeyK', 'ctrl'))).toEqual(['Ctrl+K (key)']);
    expect(chords(press('D', 'KeyD', 'ctrl shift'))).toEqual(['Ctrl+Shift+D (key)']);
    expect(chords(press('/', 'Slash', 'ctrl'))).toEqual(['Ctrl+/ (key)']);
    expect(chords(press('+', 'Equal', 'ctrl shift'))).toEqual(['Ctrl++ (key)']);
  });

  it('matches Ctrl+Shift+1 and 2 by the physical key', () => {
    expect(chords(press('!', 'Digit1', 'ctrl shift'))).toEqual(['Ctrl+! (key)', 'Ctrl+Shift+1 (code)']);
    expect(primaryChord(press('!', 'Digit1', 'ctrl shift'))).toBe('Ctrl+Shift+1');
    expect(primaryChord(press('@', 'Digit2', 'ctrl shift'))).toBe('Ctrl+Shift+2');
  });

  it('names arrows, function keys, and the space', () => {
    expect(chords(press('ArrowUp', 'ArrowUp', 'ctrl shift'))).toEqual(['Ctrl+Shift+Up (key)']);
    expect(chords(press('F6', 'F6', 'shift'))).toEqual(['Shift+F6 (key)']);
    expect(chords(press(' ', 'Space', 'alt'))).toEqual(['Alt+Space (key)']);
  });

  it('ignores modifiers alone, the Windows key, and input method composition', () => {
    expect(chords(press('Control', 'ControlLeft', 'ctrl'))).toEqual([]);
    expect(chords(press('k', 'KeyK', 'ctrl meta'))).toEqual([]);
    expect(chords(press('Process', 'KeyK'))).toEqual([]);
    expect(chords({ ...press('k', 'KeyK', 'ctrl'), isComposing: true })).toEqual([]);
  });
});

describe('key presses on other layouts', () => {
  it('French AZERTY: Ctrl+Shift+1 and 2, letters by the printed letter, and dead keys by the physical key', () => {
    expect(primaryChord(press('1', 'Digit1', 'ctrl shift'))).toBe('Ctrl+Shift+1');
    expect(primaryChord(press('2', 'Digit2', 'ctrl shift'))).toBe('Ctrl+Shift+2');
    expect(chords(press('&', 'Digit1', 'ctrl'))).toEqual(['Ctrl+& (key)', 'Ctrl+1 (code)']);
    expect(chords(press('a', 'KeyQ', 'ctrl'))).toEqual(['Ctrl+A (key)']);
    expect(chords(press('Dead', 'BracketLeft', 'ctrl'))).toEqual(['Ctrl+[ (code)']);
  });

  it('German: Ctrl+/ is Ctrl+Shift+7, and Ctrl+- never matches Ctrl+/', () => {
    expect(chords(press('/', 'Digit7', 'ctrl shift'))).toEqual(['Ctrl+/ (key)', 'Ctrl+Shift+7 (code)']);
    expect(chords(press('-', 'Slash', 'ctrl'))).toEqual(['Ctrl+- (key)']);
    expect(chords(press('z', 'KeyY', 'ctrl'))).toEqual(['Ctrl+Z (key)']);
  });

  it('Russian: letters fall back to the physical key', () => {
    expect(chords(press('л', 'KeyK', 'ctrl'))).toEqual(['Ctrl+K (code)']);
    expect(chords(press('Л', 'KeyK', 'ctrl shift'))).toEqual(['Ctrl+Shift+K (code)']);
    expect(chords(press('.', 'Slash', 'ctrl'))).toEqual(['Ctrl+. (key)']);
  });

  it('AltGr text never becomes a chord unless the chord names the typed key', () => {
    expect(chords(press('²', 'Digit2', '', true))).toEqual([]);
    expect(chords(press('ć', 'KeyC', '', true))).toEqual([]);
    expect(chords(press('h', 'KeyH', '', true))).toEqual(['Ctrl+Alt+H (key)']);
    expect(chords(press('2', 'Digit2', 'ctrl alt'))).toEqual(['Ctrl+Alt+2 (key)']);
  });
});

describe('AltGr on Polish, German, and French keyboards', () => {
  // Windows reports AltGr as Ctrl+Alt with the AltGraph state on. The key is text, so no chord matches unless the
  // chord names that typed character itself. The physical key never stands in for it.
  const altGr = (key: string, code: string) => chords(press(key, code, '', true));

  it('Polish: AltGr letters type ą, ć, ę, ł, ń, ó, ś, ź, and ż, and none of them is Ctrl+Alt+a letter', () => {
    const polish = [
      ['ą', 'KeyA'],
      ['ć', 'KeyC'],
      ['ę', 'KeyE'],
      ['ł', 'KeyL'],
      ['ń', 'KeyN'],
      ['ó', 'KeyO'],
      ['ś', 'KeyS'],
      ['ź', 'KeyX'],
      ['ż', 'KeyZ'],
    ];
    for (const [key, code] of polish) expect(altGr(key, code), key).toEqual([]);
    // The same physical keys with a real Ctrl+Alt, where the layout types the letter itself, are chords.
    expect(chords(press('l', 'KeyL', 'ctrl alt'))).toEqual(['Ctrl+Alt+L (key)']);
  });

  it('German: AltGr types @, €, {, [, ], }, \\, |, and ~, and a digit chord needs its own digit', () => {
    expect(altGr('@', 'KeyQ')).toEqual(['Ctrl+Alt+@ (key)']);
    expect(altGr('€', 'KeyE')).toEqual([]);
    expect(altGr('{', 'Digit7')).toEqual(['Ctrl+Alt+{ (key)']);
    expect(altGr('[', 'Digit8')).toEqual(['Ctrl+Alt+[ (key)']);
    expect(altGr(']', 'Digit9')).toEqual(['Ctrl+Alt+] (key)']);
    expect(altGr('}', 'Digit0')).toEqual(['Ctrl+Alt+} (key)']);
    expect(altGr('\\', 'Minus')).toEqual(['Ctrl+Alt+\\ (key)']);
    expect(altGr('|', 'IntlBackslash')).toEqual(['Ctrl+Alt+| (key)']);
    expect(altGr('~', 'BracketRight')).toEqual(['Ctrl+Alt+~ (key)']);
    expect(altGr('µ', 'KeyM')).toEqual([]);
    // No AltGr chord comes out as Ctrl+Alt+7, Ctrl+Alt+8, Ctrl+Alt+9, or Ctrl+Alt+0.
    for (const digit of ['7', '8', '9', '0']) {
      expect(['{', '[', ']', '}'].flatMap((key) => altGr(key, `Digit${digit}`))).not.toContain(
        `Ctrl+Alt+${digit} (code)`,
      );
    }
  });

  it('French (AZERTY): AltGr types @, ~, #, {, [, |, `, \\, ^, ], and }, and € and ¤ are no chord', () => {
    expect(altGr('@', 'Digit0')).toEqual(['Ctrl+Alt+@ (key)']);
    expect(altGr('~', 'Digit2')).toEqual(['Ctrl+Alt+~ (key)']);
    expect(altGr('#', 'Digit3')).toEqual(['Ctrl+Alt+# (key)']);
    expect(altGr('{', 'Digit4')).toEqual(['Ctrl+Alt+{ (key)']);
    expect(altGr('[', 'Digit5')).toEqual(['Ctrl+Alt+[ (key)']);
    expect(altGr('|', 'Digit6')).toEqual(['Ctrl+Alt+| (key)']);
    expect(altGr('`', 'Digit7')).toEqual(['Ctrl+Alt+` (key)']);
    expect(altGr('\\', 'Digit8')).toEqual(['Ctrl+Alt+\\ (key)']);
    expect(altGr('^', 'Digit9')).toEqual(['Ctrl+Alt+^ (key)']);
    expect(altGr(']', 'Minus')).toEqual(['Ctrl+Alt+] (key)']);
    expect(altGr('}', 'Equal')).toEqual(['Ctrl+Alt+} (key)']);
    expect(altGr('€', 'KeyE')).toEqual([]);
    expect(altGr('¤', 'Equal')).toEqual([]);
  });

  it('puts the match by the typed key before the match by the physical key, on every layout', () => {
    // French: & is the unshifted 1 key. German: / is Shift+7. Polish and US: a plain letter is both.
    expect(chords(press('&', 'Digit1', 'ctrl'))).toEqual(['Ctrl+& (key)', 'Ctrl+1 (code)']);
    expect(chords(press('/', 'Digit7', 'ctrl shift'))).toEqual(['Ctrl+/ (key)', 'Ctrl+Shift+7 (code)']);
    expect(chords(press('é', 'Digit2', 'ctrl'))).toEqual(['Ctrl+2 (code)']);
    expect(chords(press('k', 'KeyK', 'ctrl'))).toEqual(['Ctrl+K (key)']);
  });
});

describe('reading chords', () => {
  it('formats chords for people and for aria-keyshortcuts', () => {
    expect(formatChord(chord('Ctrl+Shift+Up'))).toBe('Ctrl+Shift+Up');
    expect(formatChord(chord('Ctrl+PageDown'))).toBe('Ctrl+Page Down');
    expect(formatChord(chord('Ctrl++'))).toBe('Ctrl+Plus');
    expect(ariaKeyShortcuts([chord('Ctrl+Shift+D'), chord('Alt+Left'), chord('Ctrl++')])).toBe(
      'Control+Shift+D Alt+ArrowLeft Control+Plus',
    );
  });

  it('shows a digit key as printed on this keyboard', async () => {
    const french = new Map([
      ['Digit0', 'à'],
      ['Digit1', '&'],
    ]);
    await loadKeyboardLayout({ keyboard: { getLayoutMap: () => Promise.resolve(french) } });
    expect(formatChord(chord('Ctrl+0'))).toBe('Ctrl+à');
    expect(formatChord(chord('Ctrl+Shift+1'))).toBe('Ctrl+Shift+1');
    await loadKeyboardLayout({ keyboard: { getLayoutMap: () => Promise.reject(new Error('denied')) } });
    expect(formatChord(chord('Ctrl+0'))).toBe('Ctrl+à');
  });
});
