import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INK_BLOCK,
  indexInk,
  inkSignature,
  inkWordsOf,
  matchingWords,
  resetHandwritingIndexForTests,
  termsOf,
  transcriptText,
} from './handwriting';
import type { HandwritingDeps } from './handwriting';

const stroke = (id: string) => ({
  id,
  points: [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
  ],
});
const word = (text: string, x: number) => ({ text, bounds: { x, y: 0, width: 10, height: 10 } });

function deps(strokes: ReturnType<typeof stroke>[], text = 'buy milk') {
  const index = vi.fn(() => Promise.resolve(true));
  const read = vi.fn(() => Promise.resolve({ text, words: [word('buy', 0), word('milk', 20)] }));
  const value: HandwritingDeps = { strokes: () => strokes, read, index };
  return { value, index, read };
}

describe('indexInk', () => {
  beforeEach(resetHandwritingIndexForTests);

  it('hands the recognized words to the index under the ink block, once per change', async () => {
    const one = deps([stroke('a')]);
    expect(await indexInk('p1', one.value)).toBe(true);
    expect(one.index).toHaveBeenCalledWith({ page: 'p1', block: INK_BLOCK, kind: 'handwriting', text: 'buy milk' });
    expect(await indexInk('p1', one.value)).toBe(false);
    expect(one.read).toHaveBeenCalledTimes(1);
    const more = deps([stroke('a'), stroke('b')]);
    await indexInk('p1', more.value);
    expect(more.read).toHaveBeenCalledTimes(1);
  });

  it('keeps the words with their boxes for marking hits', async () => {
    await indexInk('p1', deps([stroke('a')]).value);
    expect(inkWordsOf('p1').map((one) => one.text)).toEqual(['buy', 'milk']);
    expect(matchingWords(inkWordsOf('p1'), 'MILK please').map((one) => one.text)).toEqual(['milk']);
    expect(matchingWords(inkWordsOf('p1'), 'x')).toEqual([]);
  });

  it('forgets the words when the ink is cleared', async () => {
    await indexInk('p1', deps([stroke('a')]).value);
    const cleared = deps([]);
    await indexInk('p1', cleared.value);
    expect(cleared.index).toHaveBeenCalledWith({ page: 'p1', block: INK_BLOCK, kind: 'handwriting', text: '' });
    expect(inkWordsOf('p1')).toEqual([]);
  });

  it('tries again later when nothing could be read', async () => {
    const one = deps([stroke('a')]);
    one.read.mockResolvedValueOnce(null as never);
    expect(await indexInk('p1', one.value)).toBe(false);
    expect(await indexInk('p1', one.value)).toBe(true);
  });
});

describe('transcriptText', () => {
  it('joins the summary and the lines with the speakers names', () => {
    const text = transcriptText({
      summary: 'A short talk.',
      speakers: { '1': 'Ana' },
      lines: [
        { text: 'Hello', speaker: 1 },
        { text: 'Hi', speaker: 2 },
        { text: '  ' },
      ],
    });
    expect(text).toBe('A short talk.\nAna: Hello\nHi');
  });
  it('reads nothing from data of another shape', () => {
    expect(transcriptText({ lines: 4 })).toBe('');
  });
});

describe('terms', () => {
  it('splits a query into lower case words of two letters or more', () => {
    expect(termsOf('Milk, a Bread!')).toEqual(['milk', 'bread']);
    expect(inkSignature([stroke('a')])).toBe('a:2');
  });
});
