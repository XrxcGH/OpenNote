// Getting an image ready for recognition: the size it is read at, gray pixels, and the text of the result. The
// decode step is replaced, so these run without a browser.
import { describe, expect, it } from 'vitest';
import { IntelClientError, createFakeIntelTransport, createIntelClient } from '../../services/intel';
import type { ImagePixels } from '../../services/intel';
import { MAX_OCR_SIDE, readTextInImage, sizeForReading, textOfResult, toGray } from './imageText';

describe('sizeForReading', () => {
  it('keeps a small image as it is', () => {
    expect(sizeForReading(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('scales a large image down to the longest side, keeping its shape', () => {
    expect(sizeForReading(6400, 3200)).toEqual({ width: MAX_OCR_SIDE, height: 1600 });
    expect(sizeForReading(100, 9600, 3200)).toEqual({ width: 33, height: 3200 });
  });

  it('never makes a side zero', () => {
    expect(sizeForReading(1, 100_000, 3200).width).toBe(1);
  });
});

describe('toGray', () => {
  it('weights the colors by how bright they look', () => {
    const gray = toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]));
    expect([...gray]).toEqual([76, 150, 29]);
  });

  it('reads a transparent pixel as white paper', () => {
    expect([...toGray(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]))]).toEqual([255, 0]);
  });
});

describe('textOfResult', () => {
  it('joins the lines and drops the empty ones', () => {
    const box = { x: 0, y: 0, width: 0, height: 0 };
    const line = (text: string) => ({ text, bounds: box, words: [] });
    expect(textOfResult({ lines: [line(' First '), line(''), line('Second')] })).toBe('First\nSecond');
  });
});

describe('readTextInImage', () => {
  const gray: ImagePixels = { width: 2, height: 2, format: 'gray8', pixels: new Uint8Array(4) };
  const clientOver = (transport: ReturnType<typeof createFakeIntelTransport>) => () =>
    Promise.resolve(createIntelClient(transport));

  it('sends the decoded pixels to the recognizer', async () => {
    const transport = createFakeIntelTransport({ settings: { ocr: true } });
    const result = await readTextInImage(new Blob(['x']), {
      decode: () => Promise.resolve(gray),
      client: clientOver(transport),
    });
    expect(textOfResult(result)).toBe('Sample text');
    expect(transport.calls).toEqual(['intel_ocr_recognize']);
  });

  it('rejects with the feature to offer when text recognition is off', async () => {
    const transport = createFakeIntelTransport();
    const read = readTextInImage(new Blob(['x']), {
      decode: () => Promise.resolve(gray),
      client: clientOver(transport),
    });
    await expect(read).rejects.toMatchObject({ code: 'disabled', feature: 'ocr' });
  });

  it('turns a decode failure into the one error type', async () => {
    const read = readTextInImage(new Blob(['x']), { decode: () => Promise.reject(new Error('not an image')) });
    await expect(read).rejects.toBeInstanceOf(IntelClientError);
  });
});
