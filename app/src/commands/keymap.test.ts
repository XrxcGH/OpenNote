import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { commands } from '../registries';
import { settingsStore, DEFAULT_SETTINGS } from '../state/settings';
import { resetStores } from '../state/store';
import { ariaKeyShortcuts, formatChord, keysFor, shortcutHint } from './keymap';
import { chord, defineCommand, isChordText } from './registry';

beforeAll(() => {
  commands.register(
    defineCommand({
      id: 'test.keymap',
      title: 'theme.commands.toggle',
      category: 'general',
      keys: [chord('Ctrl+Shift+D')],
      presetKeys: { onenote: [chord('Ctrl+Alt+D')] },
      run() {},
    }),
  );
});

afterEach(() => resetStores());

const withSettings = (patch: Partial<typeof DEFAULT_SETTINGS>) =>
  settingsStore.set({ settings: { ...DEFAULT_SETTINGS, ...patch }, readOnly: false });

describe('chords', () => {
  it('accepts the canonical form only', () => {
    expect(isChordText('Ctrl+Shift+D')).toBe(true);
    expect(isChordText('Ctrl+Alt+Shift+F10')).toBe(true);
    expect(isChordText('Ctrl+/')).toBe(true);
    expect(isChordText('Shift+Ctrl+D')).toBe(false);
    expect(isChordText('Ctrl+Ctrl+D')).toBe(false);
    expect(isChordText('Win+D')).toBe(false);
    expect(isChordText('Ctrl+')).toBe(false);
    expect(isChordText('Ctrl+d')).toBe(false);
    expect(() => chord('Meta+K')).toThrow();
  });
});

describe('keysFor', () => {
  it('uses the defaults, then the shortcut set, then overrides', () => {
    expect(keysFor('test.keymap')).toEqual(['Ctrl+Shift+D']);
    withSettings({ keyboard: { preset: 'onenote' } });
    expect(keysFor('test.keymap')).toEqual(['Ctrl+Alt+D']);
    withSettings({ shortcuts: { 'test.keymap': ['Ctrl+Alt+K', 'not a chord'] } });
    expect(keysFor('test.keymap')).toEqual(['Ctrl+Alt+K']);
    withSettings({ shortcuts: { 'test.keymap': [] } });
    expect(keysFor('test.keymap')).toEqual([]);
    expect(keysFor('test.missing')).toEqual([]);
  });
});

describe('formatting', () => {
  it('formats chords for people and for aria-keyshortcuts', () => {
    expect(formatChord(chord('Ctrl+Shift+Up'))).toBe('Ctrl+Shift+Up');
    expect(formatChord(chord('Ctrl+PageDown'))).toBe('Ctrl+Page Down');
    expect(ariaKeyShortcuts([chord('Ctrl+Shift+D'), chord('Alt+Left')])).toBe('Control+Shift+D Alt+ArrowLeft');
    expect(shortcutHint('test.keymap')).toBe('Ctrl+Shift+D');
    expect(shortcutHint('test.missing')).toBeNull();
  });
});
