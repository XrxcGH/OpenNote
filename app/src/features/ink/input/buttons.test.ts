import { describe, expect, it } from 'vitest';
import {
  BARREL_CHOICES,
  buttonsForPen,
  DEFAULT_PEN_BUTTONS,
  ERASER_END_CHOICES,
  penKey,
  penSource,
  resolvePenAction,
  sanitizeButtons,
  suppressContextMenu,
} from './buttons';

const pen = (button: number, buttons: number) => ({ pointerType: 'pen', button, buttons });

describe('pen buttons', () => {
  it('tells the tip, the barrel button, and the eraser end apart', () => {
    expect(penSource(pen(0, 1))).toBe('tip');
    expect(penSource(pen(2, 3))).toBe('barrel');
    expect(penSource(pen(0, 3))).toBe('barrel');
    expect(penSource(pen(5, 33))).toBe('eraser');
    expect(penSource(pen(0, 32))).toBe('eraser');
    expect(penSource(pen(5, 35))).toBe('eraser');
  });

  it('leaves mouse and touch to the active tool', () => {
    expect(penSource({ pointerType: 'mouse', button: 2, buttons: 2 })).toBe('tip');
    expect(penSource({ pointerType: 'touch', button: 0, buttons: 1 })).toBe('tip');
  });

  it('resolves the action the settings choose, and nothing for the tip', () => {
    expect(resolvePenAction(pen(0, 1), DEFAULT_PEN_BUTTONS)).toEqual({ source: 'tip', action: null });
    expect(resolvePenAction(pen(2, 3), DEFAULT_PEN_BUTTONS)).toEqual({ source: 'barrel', action: 'lasso' });
    expect(resolvePenAction(pen(5, 32), DEFAULT_PEN_BUTTONS)).toEqual({ source: 'eraser', action: 'strokeEraser' });
    const custom = { barrel: 'pan', eraserEnd: 'highlighterEraser' } as const;
    expect(resolvePenAction(pen(2, 2), custom).action).toBe('pan');
    expect(resolvePenAction(pen(5, 32), custom).action).toBe('highlighterEraser');
  });

  it('offers the choices the design lists for each button', () => {
    expect(BARREL_CHOICES).toContain('rightClickMenu');
    expect(ERASER_END_CHOICES).toContain('partialEraser');
    expect(ERASER_END_CHOICES).not.toContain('lasso');
  });

  it('replaces a saved choice that is not a choice for that button', () => {
    expect(sanitizeButtons({ barrel: 'highlighterEraser', eraserEnd: 'lasso' })).toEqual(DEFAULT_PEN_BUTTONS);
    expect(sanitizeButtons({ barrel: 'pan' })).toEqual({ barrel: 'pan', eraserEnd: 'strokeEraser' });
    expect(sanitizeButtons(null)).toEqual(DEFAULT_PEN_BUTTONS);
    expect(sanitizeButtons('x')).toEqual(DEFAULT_PEN_BUTTONS);
  });

  it('keeps settings for each pen, with a default for a new one', () => {
    const saved = { '7': { barrel: 'pan', eraserEnd: 'none' }, default: { barrel: 'partialEraser' } };
    expect(penKey(7)).toBe('7');
    expect(penKey(0)).toBe('default');
    expect(penKey(undefined)).toBe('default');
    expect(buttonsForPen(saved, 7)).toEqual({ barrel: 'pan', eraserEnd: 'none' });
    expect(buttonsForPen(saved, 9)).toEqual({ barrel: 'partialEraser', eraserEnd: 'strokeEraser' });
    expect(buttonsForPen({}, 9)).toEqual(DEFAULT_PEN_BUTTONS);
  });
});

describe('the pen press-and-hold menu', () => {
  const state = { pointerType: 'pen', gestureActive: false, holdTimerRunning: false, sinceGestureEnd: 1000 };

  it('is prevented while a gesture is down, while the snap timer runs, and for 300 ms after one', () => {
    expect(suppressContextMenu({ ...state, gestureActive: true })).toBe(true);
    expect(suppressContextMenu({ ...state, holdTimerRunning: true })).toBe(true);
    expect(suppressContextMenu({ ...state, sinceGestureEnd: 299 })).toBe(true);
    expect(suppressContextMenu({ ...state, sinceGestureEnd: 300 })).toBe(false);
  });

  it('is prevented after a barrel lasso, eraser, or pan, and opens for a barrel set to the menu', () => {
    const lasso = resolvePenAction({ pointerType: 'pen', button: 2, buttons: 2 }, DEFAULT_PEN_BUTTONS);
    expect(lasso.action).toBe('lasso');
    expect(suppressContextMenu({ ...state, sinceGestureEnd: 5, action: lasso.action })).toBe(true);
    expect(suppressContextMenu({ ...state, gestureActive: true, action: 'rightClickMenu' })).toBe(false);
  });

  it('is left alone for the mouse and touch', () => {
    expect(suppressContextMenu({ ...state, pointerType: 'mouse', gestureActive: true })).toBe(false);
    expect(suppressContextMenu({ ...state, pointerType: 'touch', sinceGestureEnd: 0 })).toBe(false);
  });
});
