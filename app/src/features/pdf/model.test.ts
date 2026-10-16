import { describe, expect, it } from 'vitest';
import {
  cleanBox,
  imageBoxes,
  isPagePicture,
  lookOf,
  multiply,
  pdfOf,
  textOfWords,
  wordsOf,
  wordsOfRun,
} from './model';

const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageXObjectRepeat: 88,
};

describe('PDF page data', () => {
  it('keeps boxes inside the picture and drops empty ones', () => {
    expect(cleanBox(-0.1, 0.5, 0.3, 0.1)).toEqual([0, 0.5, 0.2, 0.1]);
    expect(cleanBox(0.2, 0.2, 0, 0.1)).toBeNull();
    expect(cleanBox(Number.NaN, 0, 1, 1)).toBeNull();
    expect(cleanBox(1.2, 0, 0.5, 0.5)).toBeNull();
  });

  it('splits a run into words with a share of its width each', () => {
    const words = wordsOfRun('Hello big world', [0, 0.1, 0.3, 0.02]);
    expect(words.map((word) => word[4])).toEqual(['Hello', 'big', 'world']);
    expect(words[0][0]).toBe(0);
    expect(words[1][0]).toBeCloseTo(0.12, 4);
    expect(words[2][2]).toBeCloseTo(0.1, 4);
  });

  it('joins words into lines in reading order', () => {
    const text = textOfWords([
      [0, 0.1, 0.1, 0.02, 'One'],
      [0.2, 0.1, 0.1, 0.02, 'line.'],
      [0, 0.2, 0.1, 0.02, 'Next'],
    ]);
    expect(text).toBe('One line.\nNext');
  });

  it('multiplies transforms in the order PDF applies them', () => {
    const scale = [2, 0, 0, 2, 0, 0];
    const move = [1, 0, 0, 1, 10, 5];
    expect(multiply(scale, move)).toEqual([2, 0, 0, 2, 10, 5]);
    expect(multiply(move, scale)).toEqual([2, 0, 0, 2, 20, 10]);
  });

  it('finds the boxes of the pictures a page paints, with save and restore', () => {
    const viewport = [1, 0, 0, -1, 0, 800];
    const ops = {
      fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.paintInlineImageXObject, 1],
      argsArray: [null, [200, 0, 0, 100, 100, 600], ['img1'], null, ['inline'], null],
    };
    const boxes = imageBoxes(ops, OPS, viewport, { width: 600, height: 800 });
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toEqual([0.1667, 0.125, 0.3333, 0.125]);
    // After restore the unit square sits at the bottom left corner.
    expect(boxes[1][0]).toBe(0);
    expect(boxes[1][1]).toBeCloseTo(0.9988, 3);
  });

  it('reads only well-formed data from a block', () => {
    const block = {
      type: 'image',
      lock: 'position' as const,
      data: {
        pdf: { file: 'a.pdf', page: 2, pages: 3 },
        words: [[0, 0, 0.1, 0.1, 'ok'], [0, 0, 'x', 0.1, 'bad'], 'nope'],
        look: 'invert',
      },
    };
    expect(pdfOf(block)).toEqual({ file: 'a.pdf', page: 2, pages: 3 });
    expect(isPagePicture(block)).toBe(true);
    expect(wordsOf(block)).toEqual([[0, 0, 0.1, 0.1, 'ok']]);
    expect(lookOf(block)).toBe('invert');
    expect(lookOf({ data: { look: 'neon' } })).toBe('dim');
    expect(isPagePicture({ type: 'image', data: { background: 'slide' } })).toBe(true);
    expect(isPagePicture({ type: 'image', data: { alt: 'x' } })).toBe(false);
    expect(isPagePicture({ type: 'image', lock: 'position', data: { background: 'slide' } })).toBe(true);
    expect(pdfOf({ type: 'text', data: { pdf: { file: 'a', page: 1, pages: 1 } } })).toBeNull();
  });
});
