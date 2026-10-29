import { describe, expect, it } from 'vitest';
import { wordBoxes } from './imageText';

describe('word boxes from text recognition', () => {
  it('turns pixel boxes into fractions and leaves out empty ones', () => {
    const word = (text: string, x: number, width: number) => ({ text, bounds: { x, y: 10, width, height: 20 } });
    const result = {
      lines: [
        {
          text: 'Sample text',
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          words: [word('Sample', 10, 50), word('text', 70, 0), word(' ', 1, 5)],
        },
      ],
    };
    expect(wordBoxes(result, 200, 100)).toEqual([[0.05, 0.1, 0.25, 0.2, 'Sample']]);
    expect(wordBoxes(result, 0, 100)).toEqual([]);
  });
});
