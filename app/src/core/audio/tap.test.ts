import { describe, expect, it } from 'vitest';
import { TapRecognizer, tapPlays } from './tap';
import type { PointerSample } from './tap';

const at = (time: number, over: Partial<PointerSample> = {}): PointerSample => ({
  id: 1,
  type: 'pen',
  x: 100,
  y: 100,
  at: time,
  ...over,
});

describe('TapRecognizer', () => {
  it('calls a quick press that barely moves a tap', () => {
    const taps = new TapRecognizer();
    taps.press(at(0));
    expect(taps.release(at(120, { x: 103 }))).toBe('tap');
  });

  it('ignores a slow press and a press that moved', () => {
    const taps = new TapRecognizer();
    taps.press(at(0));
    expect(taps.release(at(900))).toBeNull();
    taps.press(at(1000));
    expect(taps.release(at(1100, { x: 140 }))).toBeNull();
  });

  it('never calls a mouse press a tap', () => {
    const taps = new TapRecognizer();
    taps.press(at(0, { type: 'mouse' }));
    expect(taps.release(at(50, { type: 'mouse' }))).toBeNull();
  });

  it('calls two quick taps near each other a double tap, once', () => {
    const taps = new TapRecognizer();
    taps.press(at(0));
    expect(taps.release(at(80))).toBe('tap');
    taps.press(at(200, { x: 110 }));
    expect(taps.release(at(260, { x: 110 }))).toBe('double');
    taps.press(at(300));
    expect(taps.release(at(340))).toBe('tap');
  });

  it('does not join taps that are far apart in time or space', () => {
    const taps = new TapRecognizer();
    taps.press(at(0));
    taps.release(at(60));
    taps.press(at(900));
    expect(taps.release(at(950))).toBe('tap');
    taps.press(at(1000, { x: 400 }));
    expect(taps.release(at(1050, { x: 400 }))).toBe('tap');
  });

  it('drops a press that a second finger joined', () => {
    const taps = new TapRecognizer();
    taps.press(at(0));
    taps.press(at(10, { id: 2 }));
    expect(taps.release(at(50))).toBeNull();
  });

  it('plays on one tap only while listening', () => {
    expect(tapPlays('tap', true)).toBe(true);
    expect(tapPlays('tap', false)).toBe(false);
    expect(tapPlays('double', false)).toBe(true);
  });
});
