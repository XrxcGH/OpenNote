import { describe, expect, it } from 'vitest';
import { chordFromEvent } from './dispatcher';

const keys = (event: Partial<KeyboardEventInit & { isComposing: boolean }>) => ({
  key: '',
  code: '',
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  isComposing: false,
  ...event,
});

describe('chordFromEvent', () => {
  it('reads Ctrl+Shift+D, the dark mode shortcut, from the typed letter', () => {
    expect(chordFromEvent(keys({ key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+D');
    expect(chordFromEvent(keys({ key: 'd', code: 'KeyD', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+D');
  });

  it('adds every other modifier, so extra modifiers make another chord', () => {
    expect(chordFromEvent(keys({ key: 'D', code: 'KeyD', ctrlKey: true, altKey: true, shiftKey: true }))).toBe(
      'Ctrl+Alt+Shift+D',
    );
  });

  it('ignores the Windows key, modifiers alone, and input method composition', () => {
    expect(chordFromEvent(keys({ key: 'D', code: 'KeyD', ctrlKey: true, metaKey: true }))).toBeNull();
    expect(chordFromEvent(keys({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBeNull();
    expect(chordFromEvent(keys({ key: 'Process', code: 'KeyD' }))).toBeNull();
    expect(chordFromEvent(keys({ key: 'd', code: 'KeyD', isComposing: true }))).toBeNull();
  });

  it('matches letters by the physical key on non-Latin layouts', () => {
    expect(chordFromEvent(keys({ key: 'л', code: 'KeyK', ctrlKey: true }))).toBe('Ctrl+K');
  });

  it('matches digits by the physical key, whatever Shift types', () => {
    expect(chordFromEvent(keys({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+1');
    expect(chordFromEvent(keys({ key: '&', code: 'Digit1', ctrlKey: true }))).toBe('Ctrl+1');
  });

  it('names arrows, function keys, and punctuation', () => {
    expect(chordFromEvent(keys({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true, shiftKey: true }))).toBe(
      'Ctrl+Shift+Up',
    );
    expect(chordFromEvent(keys({ key: 'F6', code: 'F6' }))).toBe('F6');
    expect(chordFromEvent(keys({ key: '/', code: 'Slash', ctrlKey: true }))).toBe('Ctrl+/');
  });
});
