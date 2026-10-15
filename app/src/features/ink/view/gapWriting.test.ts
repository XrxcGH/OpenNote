import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initFlags } from '../../../app/flags';
import { densify } from '../geometry/simplify';
import type { Vec } from '../geometry/types';
import type { InkStroke } from '../model/types';
import { couldBeWriting, createGapWriter, GAP_IDLE_MS, gapInsertion, joinsWriting } from './gapWriting';
import type { InkHost } from './host';
import { LINE_HEIGHT } from './penEditing';
import type { InkSurface } from './surface';

/** A small zigzag, the shape of a written letter. */
// intel's word helpers, as plain ones: the test is of the gap, not of tidying.
vi.mock('../../intel', () => ({
  loadApi: async () => ({
    tidyRecognizedText: (text: string) => text,
    isUnsureWord: () => false,
    alternativesFor: () => [],
  }),
}));

const letter = (x: number, y: number): Vec[] =>
  densify(
    [
      { x, y },
      { x: x + 6, y: y + 14 },
      { x: x + 12, y },
      { x: x + 18, y: y + 14 },
    ],
    2,
  );

const stroke = (id: string, points: Vec[]): InkStroke =>
  ({ id, tool: 'pen', points, color: [0, 0, 0, 255], width: 2 }) as unknown as InkStroke;

describe('writing in a gap, judged by shape and place', () => {
  it('takes a letter-sized stroke, and leaves edit gestures and big drawings alone', () => {
    expect(couldBeWriting(letter(100, 100))).toBe(true);
    const strike = densify(
      [
        { x: 100, y: 200 },
        { x: 180, y: 202 },
      ],
      4,
    );
    expect(couldBeWriting(strike)).toBe(false);
    const tall = densify(
      [
        { x: 100, y: 100 },
        { x: 140, y: 100 + LINE_HEIGHT * 4 },
        { x: 180, y: 100 },
      ],
      4,
    );
    expect(couldBeWriting(tall)).toBe(false);
  });

  it('joins strokes on the same line close after the words, and not ones far off', () => {
    const words = { minX: 100, minY: 100, maxX: 140, maxY: 120 };
    expect(joinsWriting(words, { minX: 150, minY: 102, maxX: 165, maxY: 118 })).toBe(true);
    expect(joinsWriting(words, { minX: 300, minY: 102, maxX: 320, maxY: 118 })).toBe(false);
    expect(joinsWriting(words, { minX: 110, minY: 200, maxX: 130, maxY: 220 })).toBe(false);
  });

  it('finds a gap between words and the spaces the words need', () => {
    expect(gapInsertion('hello world', 5, null)).toEqual({ offset: 5, prefix: ' ', suffix: '' });
    expect(gapInsertion('hello world', 6, null)).toEqual({ offset: 6, prefix: '', suffix: ' ' });
    expect(gapInsertion('hello  world', 6, null)).toEqual({ offset: 6, prefix: '', suffix: '' });
    expect(gapInsertion('hello world', 11, null)).toEqual({ offset: 11, prefix: ' ', suffix: '' });
  });

  it('is no gap in the middle of a word, unless the caret is there', () => {
    expect(gapInsertion('hello world', 2, null)).toBeNull();
    expect(gapInsertion('hello world', 2, 3)).toEqual({ offset: 3, prefix: ' ', suffix: ' ' });
  });
});

describe('the gap writer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initFlags('dev', { 'ink.handwriting': true, 'intel.handwriting': true, 'ink.penEditing': true });
  });
  afterEach(() => {
    vi.useRealTimers();
    initFlags('dev');
  });

  function setup(read: string) {
    const inserted: { block: string; pos: number; text: string }[] = [];
    const kept: string[] = [];
    const shown = new Set<string>();
    const host = {
      handwriting: {
        recognize: async () => ({ lines: read ? [{ text: read, words: [], bounds: {} }] : [] }),
        tidy: async () => null,
      },
      text: {
        hit: async () => ({ block: 'b1', pos: 7, top: 90, bottom: 125 }),
        paragraph: async () => ({ start: 1, text: 'hello world', caret: null }),
        insert: async (block: string, pos: number, text: string) => {
          inserted.push({ block, pos, text });
          return true;
        },
        undo: async () => {},
      },
    } as unknown as InkHost;
    const surface = {
      readOnly: false,
      cameraNow: () => ({ viewport: { x: 0, y: 0 }, zoom: 1, scrollX: 0, scrollY: 0 }),
      show: (strokes: InkStroke[]) => strokes.forEach((s) => shown.add(s.id)),
      hide: (ids: string[]) => ids.forEach((id) => shown.delete(id)),
    } as unknown as InkSurface;
    const writer = createGapWriter(host, (strokes) => kept.push(...strokes.map((s) => s.id)));
    return { writer, surface, inserted, kept, shown };
  }

  it('types what was written in the gap as one insert, with the spaces around it', async () => {
    const { writer, surface, inserted, shown } = setup('big');
    expect(await writer.start(stroke('a', letter(100, 100)), surface)).toBe(true);
    expect(writer.take(stroke('b', letter(122, 100)), surface)).toBe(true);
    expect([...shown]).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(GAP_IDLE_MS + 10);
    vi.useRealTimers();
    await vi.waitFor(() => expect(inserted).toEqual([{ block: 'b1', pos: 7, text: 'big ' }]));
    expect(shown.size).toBe(0);
  });

  it('keeps the strokes as ink when nothing was read', async () => {
    const { writer, surface, inserted, kept } = setup('');
    expect(await writer.start(stroke('a', letter(100, 100)), surface)).toBe(true);
    await vi.advanceTimersByTimeAsync(GAP_IDLE_MS + 10);
    vi.useRealTimers();
    await vi.waitFor(() => expect(kept).toEqual(['a']));
    expect(inserted).toEqual([]);
  });
});
