// The client against the fake transport, which stands in for the Rust crate in tests and on the web platform.

import { describe, expect, it } from 'vitest';
import { createIntelClient } from './client';
import { IntelClientError, isIntelError, toIntelError } from './errors';
import { createFakeIntelTransport } from './fake';
import { MAX_IMAGE_SIDE, fromImageData, pixelSource, toBase64 } from './image';
import { FEATURES } from './types';
import type { Feature, ImagePixels, Transcript } from './types';

const TEXT = 'Plants make sugar from light. Plants need water. The sugar feeds the plant. Rain falls on plants.';

function setup(on: Feature[] = []) {
  const transport = createFakeIntelTransport({ settings: Object.fromEntries(on.map((f) => [f, true])) });
  return { transport, client: createIntelClient(transport) };
}

const gray = (width: number, height: number): ImagePixels => ({
  width,
  height,
  format: 'gray8',
  pixels: new Uint8Array(width * height),
});

describe('opt-in', () => {
  it('starts with every feature off and refuses each call with the feature to offer', async () => {
    const { client } = setup();
    const attempts: Array<[Feature, () => Promise<unknown>]> = [
      ['ocr', () => client.recognizeImage(gray(2, 2))],
      ['handwriting', () => client.recognizeInk([])],
      ['summaries', () => client.summarize(TEXT)],
      ['summaries', () => client.keywords(TEXT)],
      ['readAloud', () => client.voices()],
      ['readAloud', () => client.speak('Hello there.')],
      ['readAloud', () => client.readAloud('Hello there.')],
    ];
    for (const [feature, attempt] of attempts) {
      const error = await attempt().catch((e: unknown) => e);
      expect(isIntelError(error, 'disabled'), String(feature)).toBe(true);
      expect((error as IntelClientError).feature).toBe(feature);
    }
    expect((await client.status()).every((s) => !s.enabled && s.available)).toBe(true);
  });

  it('works once the person turns a feature on, and stops when they turn it off', async () => {
    const { client, transport } = setup(['summaries']);
    expect((await client.summarize(TEXT, { maxSentences: 2 })).sentences).toHaveLength(2);
    transport.setSettings({ summaries: false });
    await expect(client.summarize(TEXT)).rejects.toMatchObject({ code: 'disabled', feature: 'summaries' });
  });

  it('reports a feature with no engine as unsupported, even when it is on', async () => {
    const transport = createFakeIntelTransport({ settings: { ocr: true }, unavailable: ['ocr'] });
    const client = createIntelClient(transport);
    await expect(client.recognizeImage(gray(2, 2))).rejects.toMatchObject({ code: 'unsupported' });
    const status = (await client.status()).find((s) => s.feature === 'ocr');
    expect(status).toMatchObject({ enabled: true, available: false });
    expect(status?.unavailableReason).toBeTruthy();
  });
});

describe('the fake engines', () => {
  it('reads an image, and refuses a language it has no recognizer for', async () => {
    const { client } = setup(['ocr']);
    expect((await client.recognizeImage(gray(4, 4))).lines[0].text).toBe('Sample text');
    await expect(client.recognizeImage(gray(4, 4), { language: 'th' })).rejects.toMatchObject({
      code: 'languageUnavailable',
    });
    expect(await client.ocrLanguages()).toEqual(['en-US']);
  });

  it('reads strokes as one word and returns their keys', async () => {
    const { client } = setup(['handwriting']);
    const strokes = [
      {
        key: '0'.repeat(26),
        points: [
          [0, 0],
          [1, 1],
        ] as Array<[number, number]>,
      },
      { key: '1'.repeat(26), points: [[2, 2]] as Array<[number, number]> },
    ];
    const found = await client.recognizeInk(strokes);
    expect(found.lines[0].words[0].strokes).toEqual(strokes.map((s) => s.key));
    expect((await client.recognizeInk([])).lines).toEqual([]);
  });
});

describe('the fake text and speech engines', () => {
  it('summarizes and finds keywords with spans that point into the text', async () => {
    const { client } = setup(['summaries']);
    const summary = await client.summarize(TEXT);
    expect(summary.inputSentences).toBe(4);
    for (const sentence of summary.sentences)
      expect(TEXT.slice(sentence.span.start, sentence.span.end)).toBe(sentence.text);
    const keywords = await client.keywords(TEXT, { maxKeywords: 2 });
    expect(keywords.map((k) => k.text)).toEqual(['plants', 'sugar']);
    expect(keywords[0].score).toBe(1);
  });

  it('speaks a phrase into a WAV file with word times', async () => {
    const { client } = setup(['readAloud']);
    const spoken = await client.speak('Hello there friend.');
    expect(new TextDecoder().decode(spoken.audio.subarray(0, 4))).toBe('RIFF');
    expect(spoken.info.boundaries.filter((b) => b.kind === 'word')).toHaveLength(3);
    expect(spoken.info.durationMs).toBeGreaterThan(900);
    expect((await client.voices())[0].language).toBe('en-US');
  });

  it('reads a page one chunk per sentence, in order, with the sound of each', async () => {
    const { client } = setup(['readAloud']);
    const session = await client.readAloud(TEXT, { rate: 1.5 });
    expect(session.totalChunks).toBe(4);
    const heard: string[] = [];
    for await (const chunk of session) {
      expect(new TextDecoder().decode((await chunk.audio()).subarray(0, 4))).toBe('RIFF');
      heard.push(TEXT.slice(chunk.span.start, chunk.span.end));
    }
    expect(heard.join(' ')).toBe(TEXT);
  });

  it('refuses a clip it never made, and text with nothing to read', async () => {
    const { client, transport } = setup(['readAloud']);
    await expect(transport.invoke('intel_clip_audio', { clipId: 'nope' })).rejects.toMatchObject({
      code: 'invalidInput',
    });
    await expect(client.readAloud('   ')).rejects.toMatchObject({ code: 'invalidInput' });
  });
});

describe('the fake transcript and ink tools', () => {
  const transcript: Transcript = {
    language: 'en',
    device: 'cpu',
    segments: [
      { startMs: 0, endMs: 9000, text: 'We decided to ship in March. The weather is nice.' },
      { startMs: 10000, endMs: 19000, text: 'Maria will send the notes. Light and water feed the plants.' },
    ],
  };

  it('refuse until the feature is on', async () => {
    const { client } = setup();
    const refused = async (attempt: () => Promise<unknown>, feature: Feature) => {
      const error = await attempt().catch((e: unknown) => e);
      expect(isIntelError(error, 'disabled')).toBe(true);
      expect((error as IntelClientError).feature).toBe(feature);
    };
    await refused(() => client.tidyInk([], { lines: [] }, { kind: 'straighten' }), 'handwriting');
    await refused(() => client.actionItems(transcript), 'summaries');
    await refused(() => client.chapters(transcript), 'summaries');
    await refused(() => client.vocabularyOffer('ATP', 'adp', 'ADP'), 'transcription');
  });

  it('find suggestions once on', async () => {
    const { client } = setup(['summaries', 'transcription', 'handwriting']);
    const items = await client.actionItems(transcript);
    expect(items.map((i) => [i.kind, i.segment])).toEqual([
      ['decision', 0],
      ['task', 1],
    ]);
    const [chapter] = await client.chapters(transcript);
    expect([chapter.firstSegment, chapter.lastSegment, chapter.endMs]).toEqual([0, 1, 19000]);
    expect(await client.vocabularyOffer('ATP', 'adp', 'ADP')).toEqual({ term: 'ADP', heardAs: 'adp' });
    expect(await client.vocabularyOffer('ATP', 'atp', 'ATP')).toBeNull();
    expect(await client.vocabularyOffer('ATP', 'fiber', 'Fiber')).toBeNull();
    expect(await client.vocabularyOffer('ATP', 'raghunathan', 'Raghunathan')).not.toBeNull();
    expect(await client.tidyInk([], { lines: [] }, { kind: 'reflow', width: 100 })).toEqual({
      moves: [],
      bounds: null,
    });
    expect(await client.chapters({ ...transcript, segments: [] })).toEqual([]);
  });
});

describe('pixels', () => {
  it('encodes base64 for an image far larger than one call can spread', () => {
    const bytes = Uint8Array.from({ length: 300_000 }, (_, i) => i % 251);
    expect(Buffer.from(toBase64(bytes), 'base64').equals(Buffer.from(bytes))).toBe(true);
    expect(toBase64(new Uint8Array())).toBe('');
  });

  it('checks the byte count before anything is sent', () => {
    expect(pixelSource(gray(3, 2)).pixels).toHaveLength(8);
    expect(() => pixelSource({ ...gray(3, 2), pixels: new Uint8Array(5) })).toThrow(IntelClientError);
    expect(() => pixelSource({ width: 2, height: 2, format: 'rgba8', pixels: new Uint8Array(4) })).toThrow(
      /needs 16 bytes/,
    );
    expect(() => pixelSource(gray(0, 4))).toThrow(IntelClientError);
  });

  it('refuses an image over the size limits before it reads a byte', () => {
    const code = (image: Parameters<typeof pixelSource>[0]) => {
      try {
        pixelSource(image);
        return 'accepted';
      } catch (error) {
        return error instanceof IntelClientError ? error.code : String(error);
      }
    };
    // A 50-megapixel phone photo. The pixels are left empty: the size alone is enough to refuse it.
    expect(code({ width: 8160, height: 6120, format: 'rgba8', pixels: new Uint8Array() })).toBe('imageTooLarge');
    expect(code({ width: MAX_IMAGE_SIDE + 1, height: 1, format: 'gray8', pixels: new Uint8Array() })).toBe(
      'imageTooLarge',
    );
    expect(code(gray(MAX_IMAGE_SIDE, 2))).toBe('accepted');
  });

  it('takes canvas image data as RGBA', () => {
    const data = new Uint8ClampedArray(16);
    expect(fromImageData({ width: 2, height: 2, data })).toEqual({
      width: 2,
      height: 2,
      format: 'rgba8',
      pixels: data,
    });
  });
});

describe('errors', () => {
  it('reads the Rust error, the IPC error, and anything else', () => {
    expect(toIntelError({ code: 'disabled', message: 'm', feature: 'ocr' })).toMatchObject({
      code: 'disabled',
      feature: 'ocr',
    });
    expect(toIntelError({ code: 'disabled', message: 'm', field: 'readAloud' }).feature).toBe('readAloud');
    expect(toIntelError({ code: 'disabled', message: 'm', field: 'bogus' }).feature).toBeNull();
    expect(toIntelError({ code: 'notImplemented', message: 'no such command' })).toMatchObject({ code: 'unknown' });
    expect(toIntelError(new Error('lost the connection'))).toMatchObject({
      code: 'unknown',
      message: 'lost the connection',
    });
    expect(toIntelError('plain text').message).toBe('plain text');
    const same = new IntelClientError('canceled', 'x');
    expect(toIntelError(same)).toBe(same);
  });

  it('lists every feature once', () => {
    expect(new Set(FEATURES).size).toBe(FEATURES.length);
  });
});
