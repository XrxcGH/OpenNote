// The TypeScript types and requests against the JSON the Rust crate writes (crates/intel/tests/fixtures/wire).
// Each fixture is compared with an example typed by the TypeScript types, so a field that is renamed, added, or
// dropped on either side fails here. Rewrite the fixtures from Rust with UPDATE_WIRE=1 after a deliberate change.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createIntelClient } from './client';
import { isIntelError, toIntelError } from './errors';
import { MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE } from './image';
import type { IntelCommand, IntelCommands, IntelTransport } from './transport';
import type {
  ActionItem,
  Boundary,
  Chapter,
  ErrorInfo,
  FeatureStatus,
  InkRecognition,
  IntelSettings,
  Keyword,
  OcrResult,
  ReadAloudNotice,
  ReadAloudStarted,
  SpeechClip,
  Summary,
  TidyPlan,
  TidyRequest,
  Transcript,
  VocabularyOffer,
  VocabularyOfferRequest,
  Voice,
} from './types';

const WIRE = fileURLToPath(new URL('../../../../crates/intel/tests/fixtures/wire/', import.meta.url));

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(WIRE, name), 'utf8')) as T;
}

/** The ways `actual` differs from `example` in its keys and kinds of value. A null on either side matches. */
function differences(actual: unknown, example: unknown, path = '$'): string[] {
  if (actual === null || example === null) return [];
  if (Array.isArray(actual) || Array.isArray(example)) {
    if (!Array.isArray(actual) || !Array.isArray(example)) return [`${path} is not an array on both sides`];
    return actual.flatMap((item, i) => differences(item, example[0], `${path}[${i}]`));
  }
  if (typeof actual === 'object' && typeof example === 'object') {
    const a = actual as Record<string, unknown>;
    const e = example as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(e)]);
    return [...keys].flatMap((key) =>
      key in a && key in e ? differences(a[key], e[key], `${path}.${key}`) : [`${path}.${key} is on one side only`],
    );
  }
  return typeof actual === typeof example ? [] : [`${path} is ${typeof actual}, expected ${typeof example}`];
}

/** Every key of `part` is in `whole` with the same value. The client sends only what the caller set. */
function isSubset(part: unknown, whole: unknown): boolean {
  if (typeof part !== 'object' || part === null) return part === whole;
  if (typeof whole !== 'object' || whole === null) return false;
  const w = whole as Record<string, unknown>;
  return Object.entries(part).every(([key, value]) => key in w && isSubset(value, w[key]));
}

const RECT = { x: 0, y: 0, width: 0, height: 0 };
const SPAN = { start: 0, end: 0 };
const INFO = { durationMs: 0, boundaries: [{ kind: 'word', startMs: 0, endMs: 0, text: SPAN } satisfies Boundary] };

const RESPONSE_CASES: Array<[string, unknown]> = [
  [
    'settings.json',
    { ocr: true, handwriting: true, readAloud: true, summaries: true, transcription: true } satisfies IntelSettings,
  ],
  [
    'status.json',
    [{ feature: 'ocr', enabled: true, available: true, unavailableReason: null }] satisfies FeatureStatus[],
  ],
  ['errors.json', [{ code: 'disabled', message: '', feature: 'ocr' }] satisfies ErrorInfo[]],
  [
    'ocr_result.json',
    {
      language: 'en-US',
      lines: [{ text: '', bounds: RECT, words: [{ text: '', bounds: RECT }] }],
      angle: 1,
    } satisfies OcrResult,
  ],
  [
    'ink_recognition.json',
    {
      lines: [{ text: '', bounds: RECT, words: [{ text: '', alternates: [''], strokes: [''], bounds: RECT }] }],
    } satisfies InkRecognition,
  ],
  [
    'summary.json',
    { language: 'en', sentences: [{ text: '', span: SPAN, score: 1 }], inputSentences: 1 } satisfies Summary,
  ],
  ['keywords.json', [{ text: '', score: 1, count: 1 }] satisfies Keyword[]],
  ['voices.json', [{ id: '', name: '', language: 'en-US', gender: 'female' }] satisfies Voice[]],
  ['tidy_plan.json', { moves: [{ key: '', transform: [1, 0, 0, 1, 0, 0] }], bounds: RECT } satisfies TidyPlan],
  [
    'action_items.json',
    [{ kind: 'task', text: '', segment: 0, startMs: 0, owner: 'Maria', due: 'by Friday' }] satisfies ActionItem[],
  ],
  [
    'chapters.json',
    [{ startMs: 0, endMs: 0, firstSegment: 0, lastSegment: 0, title: '', keywords: [''] }] satisfies Chapter[],
  ],
  ['vocabulary_offer.json', { term: '', heardAs: '' } satisfies VocabularyOffer],
  ['speech_clip.json', { clipId: '', info: INFO } satisfies SpeechClip],
  ['read_aloud_started.json', { sessionId: '', totalChunks: 0 } satisfies ReadAloudStarted],
  [
    'read_aloud_notices.json',
    [
      { kind: 'chunk', index: 0, total: 1, span: SPAN, info: INFO, clipId: '' },
      { kind: 'finished' },
    ] satisfies ReadAloudNotice[],
  ],
];

describe('responses from the Rust crate', () => {
  it.each(RESPONSE_CASES)('%s has the shape the types describe', (name, example) => {
    const actual = fixture<unknown>(name);
    if (name === 'read_aloud_notices.json') {
      // A union: compare each notice with the example of its kind.
      for (const notice of actual as ReadAloudNotice[]) {
        const match = (example as ReadAloudNotice[]).find((e) => e.kind === notice.kind);
        expect(match, `a notice of kind ${notice.kind}`).toBeDefined();
        expect(differences(notice, match)).toEqual([]);
      }
      return;
    }
    expect(differences(actual, example)).toEqual([]);
  });

  it('a failure notice carries an error the client can read', () => {
    const failed = fixture<Extract<ReadAloudNotice, { kind: 'failed' }>>('read_aloud_failed.json');
    expect(failed.kind).toBe('failed');
    expect(differences(failed.error, { code: 'engine', message: '', feature: null })).toEqual([]);
  });

  it('every kind of stroke key and error code the crate writes is one the client knows', () => {
    for (const info of fixture<ErrorInfo[]>('errors.json')) {
      const error = toIntelError(info);
      expect(error.code).toBe(info.code);
      expect(error.feature).toBe(info.feature);
      expect(isIntelError(error, info.code)).toBe(true);
    }
    for (const line of fixture<InkRecognition>('ink_recognition.json').lines) {
      for (const word of line.words)
        expect(word.strokes.every((key) => /^[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(key))).toBe(true);
    }
  });
});

/** A transport that records requests and answers from a table. */
function scripted(results: { [K in IntelCommand]?: IntelCommands[K]['result'] }) {
  const requests: Array<{ command: string; args: unknown }> = [];
  const transport: IntelTransport = {
    invoke: async (command, args) => {
      requests.push({ command, args });
      const result = results[command];
      if (result === undefined) throw new Error(`no answer scripted for ${command}`);
      return result;
    },
  };
  return { transport, requests };
}

describe('requests the client sends', () => {
  it('sends the same image request the Rust side reads', async () => {
    const { transport, requests } = scripted({ intel_ocr_recognize: fixture<OcrResult>('ocr_result.json') });
    const pixels = new Uint8Array([255, 255, 0, 0, 255, 0, 0, 255]);
    const result = await createIntelClient(transport).recognizeImage(
      { width: 4, height: 2, format: 'gray8', pixels },
      { language: 'en-US' },
    );
    expect(result.lines[0].text).toBe('HELLO PEOPLE');
    expect(requests).toEqual([{ command: 'intel_ocr_recognize', args: { request: fixture('ocr_request.json') } }]);
  });

  it('refuses images by the same size limits as the Rust side', () => {
    expect(fixture('image_limits.json')).toEqual({ maxImageSide: MAX_IMAGE_SIDE, maxImagePixels: MAX_IMAGE_PIXELS });
  });

  it('sends the same ink request the Rust side reads', async () => {
    const { transport, requests } = scripted({ intel_ink_recognize: fixture<InkRecognition>('ink_recognition.json') });
    const sample = fixture<{ strokes: Array<{ key: string; points: Array<[number, number]> }> }>('ink_request.json');
    const result = await createIntelClient(transport).recognizeInk(sample.strokes, { kind: 'writing' });
    expect(result.lines[0].text).toBe('HELLO OPEN');
    expect(requests[0].args).toEqual({ request: fixture('ink_request.json') });
  });

  it('sends text requests that the Rust side reads, leaving out what the caller did not set', async () => {
    const { transport, requests } = scripted({
      intel_summarize: fixture<Summary>('summary.json'),
      intel_keywords: fixture<Keyword[]>('keywords.json'),
    });
    const client = createIntelClient(transport);
    const text = fixture<{ text: string }>('summarize_request.json').text;
    await client.summarize(text, { maxSentences: 2 });
    await client.keywords(text, { maxKeywords: 4 });
    await client.summarize(text);
    const [summarize, keywords, bare] = requests.map((r) => (r.args as { request: Record<string, unknown> }).request);
    expect(isSubset(summarize, fixture('summarize_request.json'))).toBe(true);
    expect(isSubset(keywords, fixture('keywords_request.json'))).toBe(true);
    expect(bare).toEqual({ text });
  });
});

describe('requests for tidying and transcripts', () => {
  it('sends the tidy request the Rust side reads, and gets its plan', async () => {
    const { transport, requests } = scripted({ intel_ink_tidy: fixture<TidyPlan>('tidy_plan.json') });
    const sample = fixture<TidyRequest>('tidy_request.json');
    const plan = await createIntelClient(transport).tidyInk(sample.strokes, sample.recognition, sample.operation);
    expect(plan.moves).toHaveLength(1);
    expect(plan.moves[0].transform).toHaveLength(6);
    expect(requests).toEqual([{ command: 'intel_ink_tidy', args: { request: sample } }]);
  });

  it('sends the transcript requests the Rust side reads', async () => {
    const { transport, requests } = scripted({
      intel_action_items: fixture<ActionItem[]>('action_items.json'),
      intel_chapters: fixture<Chapter[]>('chapters.json'),
      intel_vocabulary_offer: fixture<VocabularyOffer>('vocabulary_offer.json'),
    });
    const client = createIntelClient(transport);
    const { transcript } = fixture<{ transcript: Transcript }>('action_items_request.json');
    expect((await client.actionItems(transcript)).map((i) => i.kind)).toEqual(['decision', 'task']);
    expect((await client.chapters(transcript, { maxChapters: 12 })).map((c) => c.firstSegment)).toEqual([0, 6]);
    await client.chapters(transcript);
    const offer = fixture<VocabularyOfferRequest>('vocabulary_offer_request.json');
    expect(await client.vocabularyOffer(offer.vocabulary, offer.original, offer.fixed)).toEqual({
      term: 'ADP',
      heardAs: 'adp',
    });

    const args = requests.map((r) => (r.args as { request: Record<string, unknown> }).request);
    expect(args[0]).toEqual(fixture('action_items_request.json'));
    expect(isSubset(args[1], fixture('chapters_request.json'))).toBe(true);
    expect(args[2], 'options are left out when not set').toEqual({ transcript });
    expect(args[3]).toEqual(offer);
  });
});

describe('speech requests', () => {
  it('sends the synthesize request the Rust side reads', async () => {
    const clip = fixture<SpeechClip>('speech_clip.json');
    const { transport, requests } = scripted({ intel_speech_synthesize: clip, intel_clip_audio: [82, 73, 70, 70] });
    const request = fixture<{ text: string }>('synthesize_request.json');
    const spoken = await createIntelClient(transport).speak(request.text);
    expect(spoken.info).toEqual(clip.info);
    const sent = (requests[0].args as { request: unknown }).request;
    expect(isSubset(sent, request)).toBe(true);
  });

  it('sends the read-aloud request the Rust side reads', async () => {
    const { transport, requests } = scripted({ intel_read_aloud_start: { sessionId: 's1', totalChunks: 2 } });
    const request = fixture<{ text: string }>('read_aloud_request.json');
    await createIntelClient(transport).readAloud(request.text, { rate: 1.25, maxChunkChars: 40 });
    const sent = (requests[0].args as { request: unknown }).request;
    expect(isSubset(sent, request)).toBe(true);
  });
});
