import { describe, expect, it } from 'vitest';
import { caretLook } from './caret';
import { DEFAULT_PREFS } from './prefs';

describe('thicker caret', () => {
  it('leaves the browser caret alone for the Windows default', () => {
    const look = caretLook(DEFAULT_PREFS, { widthPx: 1, blinkMs: 530, color: null });
    expect(look).toEqual({ width: 1, blinkMs: 530, custom: false, color: null });
  });

  it('follows a thicker Windows caret, in CSS pixels at the screen density', () => {
    const look = caretLook(DEFAULT_PREFS, { widthPx: 6, blinkMs: 530, color: null }, 2);
    expect(look.width).toBe(3);
    expect(look.custom).toBe(true);
  });

  it('follows Windows when the caret never blinks', () => {
    const look = caretLook(DEFAULT_PREFS, { widthPx: 1, blinkMs: null, color: null });
    expect(look.blinkMs).toBeNull();
    expect(look.custom).toBe(true);
  });

  it('uses the chosen width when it does not follow Windows', () => {
    const look = caretLook(
      { ...DEFAULT_PREFS, caretFollowsWindows: false, caretWidth: 4 },
      { widthPx: 1, blinkMs: 530, color: null },
    );
    expect(look).toEqual({ width: 4, blinkMs: 530, custom: true, color: null });
  });

  it('draws a steady caret when asked, even at one pixel', () => {
    const look = caretLook({ ...DEFAULT_PREFS, caretSteady: true }, { widthPx: 1, blinkMs: 530, color: null });
    expect(look).toEqual({ width: 1, blinkMs: null, custom: true, color: null });
  });

  it('falls back to a blinking one-pixel caret when Windows cannot be read', () => {
    expect(caretLook(DEFAULT_PREFS, null).custom).toBe(false);
  });

  it('follows the Windows text cursor indicator color', () => {
    const look = caretLook(DEFAULT_PREFS, { widthPx: 1, blinkMs: 530, color: '#ff8800' });
    expect(look.color).toBe('#ff8800');
    expect(look.custom).toBe(true);
  });

  it('ignores the indicator color when not following Windows or when it is not a color', () => {
    const windows = { widthPx: 1, blinkMs: 530, color: '#ff8800' };
    expect(caretLook({ ...DEFAULT_PREFS, caretFollowsWindows: false }, windows).color).toBeNull();
    expect(caretLook(DEFAULT_PREFS, { ...windows, color: 'red;}' }).color).toBeNull();
  });
});
