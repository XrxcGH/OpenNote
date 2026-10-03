import { describe, expect, it } from 'vitest';
import { caretLook } from './caret';
import { DEFAULT_PREFS } from './prefs';

describe('thicker caret', () => {
  it('leaves the browser caret alone for the Windows default', () => {
    const look = caretLook(DEFAULT_PREFS, { widthPx: 1, blinkMs: 530 });
    expect(look).toEqual({ width: 1, blinkMs: 530, custom: false });
  });

  it('follows a thicker Windows caret, in CSS pixels at the screen density', () => {
    const look = caretLook(DEFAULT_PREFS, { widthPx: 6, blinkMs: 530 }, 2);
    expect(look.width).toBe(3);
    expect(look.custom).toBe(true);
  });

  it('follows Windows when the caret never blinks', () => {
    const look = caretLook(DEFAULT_PREFS, { widthPx: 1, blinkMs: null });
    expect(look.blinkMs).toBeNull();
    expect(look.custom).toBe(true);
  });

  it('uses the chosen width when it does not follow Windows', () => {
    const look = caretLook(
      { ...DEFAULT_PREFS, caretFollowsWindows: false, caretWidth: 4 },
      { widthPx: 1, blinkMs: 530 },
    );
    expect(look).toEqual({ width: 4, blinkMs: 530, custom: true });
  });

  it('draws a steady caret when asked, even at one pixel', () => {
    const look = caretLook({ ...DEFAULT_PREFS, caretSteady: true }, { widthPx: 1, blinkMs: 530 });
    expect(look).toEqual({ width: 1, blinkMs: null, custom: true });
  });

  it('falls back to a blinking one-pixel caret when Windows cannot be read', () => {
    expect(caretLook(DEFAULT_PREFS, null).custom).toBe(false);
  });
});
