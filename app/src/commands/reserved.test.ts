import { describe, expect, it } from 'vitest';
import { chord } from './chords';
import { NAVIGATION_CHORDS, WINDOWS_CHORDS, chordProblem } from './reserved';

describe('reserved chords', () => {
  it('keeps the navigation keys and the chords Windows owns', () => {
    expect(NAVIGATION_CHORDS.map((text) => chordProblem(chord(text)))).toEqual(
      NAVIGATION_CHORDS.map(() => 'navigation'),
    );
    expect(WINDOWS_CHORDS.map((text) => chordProblem(chord(text)))).toEqual(WINDOWS_CHORDS.map(() => 'windows'));
  });

  it('refuses single printable keys and Shift with a printable key', () => {
    for (const text of ['K', '7', '/', 'Shift+K', 'Shift+7', 'Shift+Space']) {
      expect(chordProblem(chord(text)), text).toBe('typesText');
    }
  });

  it('accepts chords with Ctrl or Alt, function keys, and named keys', () => {
    for (const text of ['Ctrl+K', 'Alt+1', 'Ctrl+Alt+Shift+F', 'F2', 'Shift+F7', 'Delete', 'Ctrl+Shift+Up']) {
      expect(chordProblem(chord(text)), text).toBeNull();
    }
  });
});
