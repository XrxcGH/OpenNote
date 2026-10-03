// Handwriting to text and the seam for search. Both read through the client, and both stay quiet where they should:
// the pen layer registers the strokes, and search never asks the person anything.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../app/flags';
import { createFakeIntelTransport, createIntelClient } from '../../services/intel';
import type { InkStroke } from '../../services/intel';
import { linesOf, readHandwriting, registerInkStrokeSource } from './ink';
import { searchTextInInk, searchTextReady } from './search';
import { installTestHost } from './testing';

const stroke = (key: string): InkStroke => ({
  key,
  points: [
    [0, 0],
    [10, 10],
  ],
});

describe('readHandwriting', () => {
  let remove: (() => void) | null = null;
  afterEach(() => void remove?.());
  const clientOver = (transport: ReturnType<typeof createFakeIntelTransport>) => () =>
    Promise.resolve(createIntelClient(transport));

  it('reads nothing until the pen layer has registered its strokes', async () => {
    const transport = createFakeIntelTransport({ settings: { handwriting: true } });
    const lines = await readHandwriting(['a'], {
      client: clientOver(transport),
      ensureOn: () => Promise.resolve(true),
    });
    expect(lines).toBeNull();
    expect(transport.calls).toEqual([]);
  });

  it('turns the registered strokes into lines of text', async () => {
    const asked: (readonly string[])[] = [];
    remove = registerInkStrokeSource({
      strokes: (ids) => {
        asked.push(ids);
        return ids.map(stroke);
      },
    });
    const transport = createFakeIntelTransport({ settings: { handwriting: true } });
    const lines = await readHandwriting(['a', 'b'], {
      client: clientOver(transport),
      ensureOn: () => Promise.resolve(true),
    });
    expect(lines).toEqual(['sample']);
    expect(asked).toEqual([['a', 'b']]);
  });

  it('gives an empty list when the strokes are gone, and null when the person says not now', async () => {
    remove = registerInkStrokeSource({ strokes: () => [] });
    const transport = createFakeIntelTransport({ settings: { handwriting: true } });
    const options = { client: clientOver(transport) };
    expect(await readHandwriting(['a'], { ...options, ensureOn: () => Promise.resolve(true) })).toEqual([]);
    expect(await readHandwriting(['a'], { ...options, ensureOn: () => Promise.resolve(false) })).toBeNull();
  });

  it('keeps the lines that have words', () => {
    const box = { x: 0, y: 0, width: 0, height: 0 };
    expect(
      linesOf({
        lines: [
          { text: ' one ', bounds: box, words: [] },
          { text: '', bounds: box, words: [] },
        ],
      }),
    ).toEqual(['one']);
  });
});

describe('the seam for search', () => {
  beforeEach(() => initFlags('dev'));

  it('says the text is not ready while the person has not turned the feature on', async () => {
    installTestHost();
    expect(await searchTextReady('image')).toBe(false);
    expect(await searchTextInInk([stroke('a')])).toBeNull();
  });

  it('is not ready where the flag is off', async () => {
    installTestHost({ settings: { handwriting: true } });
    initFlags('stable');
    expect(await searchTextReady('handwriting')).toBe(false);
  });

  it('gives the words and their boxes once the feature is on', async () => {
    installTestHost({ settings: { handwriting: true } });
    const found = await searchTextInInk([stroke('a')]);
    expect(found).toMatchObject({ source: 'handwriting', text: 'sample' });
    expect(found?.words.map((word) => word.text)).toEqual(['sample']);
  });

  it('gives null, not an error, for strokes that are not there', async () => {
    installTestHost({ settings: { handwriting: true } });
    expect(await searchTextInInk([])).toBeNull();
  });
});
