import { describe, expect, it } from 'vitest';
import { typewriterDelta, typewriterTarget } from './typewriter';

describe('typewriter scrolling', () => {
  const view = { top: 100, height: 600 };

  it('scrolls down by the distance the caret is below the set height', () => {
    expect(typewriterDelta(520, view, 50)).toBe(120);
  });

  it('scrolls up when the caret is above it', () => {
    expect(typewriterDelta(250, view, 50)).toBe(-150);
  });

  it('names the offset to scroll to, so a glide already on its way is not added to', () => {
    // Half way through a glide the caret reads 520 and the page is at 300: the answer is 420 however often it is asked.
    expect(typewriterTarget(300, 520, view, 50)).toBe(420);
    expect(typewriterTarget(300, 520, view, 50)).toBe(420);
    expect(typewriterTarget(50, 250, view, 50)).toBe(0);
  });

  it('holds still when the caret is on the line, and follows the chosen height', () => {
    expect(typewriterDelta(400, view, 50)).toBe(0);
    expect(typewriterDelta(400, view, 25)).toBe(150);
  });
});
