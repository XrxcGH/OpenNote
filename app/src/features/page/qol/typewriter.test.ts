import { describe, expect, it } from 'vitest';
import { typewriterDelta } from './typewriter';

describe('typewriter scrolling', () => {
  const view = { top: 100, height: 600 };

  it('scrolls down by the distance the caret is below the set height', () => {
    expect(typewriterDelta(520, view, 50)).toBe(120);
  });

  it('scrolls up when the caret is above it', () => {
    expect(typewriterDelta(250, view, 50)).toBe(-150);
  });

  it('holds still when the caret is on the line, and follows the chosen height', () => {
    expect(typewriterDelta(400, view, 50)).toBe(0);
    expect(typewriterDelta(400, view, 25)).toBe(150);
  });
});
