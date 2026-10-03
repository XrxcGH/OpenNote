// A stand-in for the Rust intel crate, for tests and the web platform, where there are no Windows engines.
// It keeps the rules that matter to the interface. Every feature is off until it is turned on, a feature
// without an engine is refused, and read aloud is pulled one chunk at a time. The answers are simple and fixed, not
// recognition: use the Rust crate's recordings to test accuracy.

import { FEATURES } from './types';
import type {
  ActionItem,
  Boundary,
  Feature,
  FeatureStatus,
  InkRecognition,
  IntelErrorCode,
  IntelSettings,
  Keyword,
  OcrResult,
  ReadAloudNotice,
  SpeechInfo,
  Summary,
  Voice,
} from './types';
import { createFakeExt } from './extFake';
import type { FakeExt } from './extFake';
import type { IntelCommands, IntelTransport } from './transport';

export interface FakeIntelOptions {
  /** What the person has turned on. Everything starts off, as on a fresh install. */
  settings?: Partial<IntelSettings>;
  /** Features with no engine here. Left out means available. */
  unavailable?: Feature[];
  /** The answer to every image. */
  ocr?: OcrResult;
  /** The answer to every set of strokes. Left out reads all the strokes as the word "sample". */
  ink?: InkRecognition;
}

export interface FakeIntelTransport extends IntelTransport {
  /** The commands received, in order. */
  readonly calls: string[];
  /** Turns features on or off, as the settings screen does. */
  setSettings(patch: Partial<IntelSettings>): void;
  /** The device store and model downloads (ext.ts). */
  readonly ext: FakeExt;
}

const WORD_MS = 300;
const SENTENCE_PAUSE_MS = 200;
const SAMPLE_RATE = 8000;
const VOICE: Voice = { id: 'fake-voice', name: 'Fake voice', language: 'en-US', gender: 'unspecified' };
const COMMON = new Set(['this', 'that', 'with', 'from', 'have', 'there', 'their', 'about', 'which', 'would']);
const NO_BOUNDS = { x: 0, y: 0, width: 0, height: 0 };

type Handlers = { [K in keyof IntelCommands]: (args: IntelCommands[K]['args']) => IntelCommands[K]['result'] };
type Sentence = { text: string; start: number };

function reject(code: IntelErrorCode, message: string, feature: Feature | null = null): never {
  throw { code, message, feature };
}

function sentencesOf(text: string): Sentence[] {
  return [...text.matchAll(/[^.!?\n]+[.!?]*/g)]
    .map((m) => ({ text: m[0].trim(), start: m.index + m[0].indexOf(m[0].trim()) }))
    .filter((s) => /[\p{L}\p{N}]/u.test(s.text));
}

function infoFor(text: string): SpeechInfo {
  const boundaries: Boundary[] = [];
  let clock = 0;
  for (const sentence of sentencesOf(text)) {
    const firstAt = boundaries.length;
    const startMs = clock;
    for (const word of sentence.text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}']*/gu)) {
      const start = sentence.start + word.index;
      const span = { start, end: start + word[0].length };
      boundaries.push({ kind: 'word', startMs: clock, endMs: clock + WORD_MS, text: span });
      clock += WORD_MS;
    }
    const end = sentence.start + sentence.text.length;
    boundaries.splice(firstAt, 0, { kind: 'sentence', startMs, endMs: clock, text: { start: sentence.start, end } });
    clock += SENTENCE_PAUSE_MS;
  }
  return { durationMs: clock, boundaries };
}

/** A WAV file of silence. */
function silentWav(ms: number): ArrayBuffer {
  const samples = Math.round((ms * SAMPLE_RATE) / 1000);
  const bytes = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(bytes);
  const tag = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  tag(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples * 2, true);
  return bytes;
}

function keywordsOf(text: string, max: number): Keyword[] {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[\p{L}][\p{L}']{3,}/gu) ?? []) {
    if (!COMMON.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max);
  const best = ranked[0]?.[1] ?? 1;
  return ranked.map(([word, count]) => ({ text: word, score: count / best, count }));
}

/** What the handlers share: the person's choices, the clips made, and the sentences each session has left. */
interface FakeState {
  settings: IntelSettings;
  clips: Map<string, ArrayBuffer>;
  sessions: Map<string, { pieces: Sentence[]; next: number }>;
  need(feature: Feature): void;
  storeClip(text: string): { clipId: string; info: SpeechInfo };
  nextId(prefix: string): string;
}

function createState(options: FakeIntelOptions): FakeState {
  const settings = Object.fromEntries(FEATURES.map((f) => [f, options.settings?.[f] ?? false])) as IntelSettings;
  const clips = new Map<string, ArrayBuffer>();
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${++counter}`;
  return {
    settings,
    clips,
    sessions: new Map(),
    nextId,
    need(feature) {
      if (!settings[feature]) reject('disabled', `${feature} is turned off`, feature);
      if (options.unavailable?.includes(feature)) reject('unsupported', `${feature} is not available here`);
    },
    storeClip(text) {
      const info = infoFor(text);
      const clipId = nextId('clip');
      clips.set(clipId, silentWav(info.durationMs));
      return { clipId, info };
    },
  };
}

function statusHandlers(
  state: FakeState,
  options: FakeIntelOptions,
): Pick<Handlers, 'intel_status' | 'intel_ocr_languages'> {
  return {
    intel_status: () =>
      FEATURES.map<FeatureStatus>((feature) => {
        const available = !options.unavailable?.includes(feature);
        return {
          feature,
          enabled: state.settings[feature],
          available,
          unavailableReason: available ? null : 'it is not available on this platform',
        };
      }),
    intel_ocr_languages: () => ['en-US'],
  };
}

function recognitionHandlers(
  state: FakeState,
  options: FakeIntelOptions,
): Pick<Handlers, 'intel_ocr_recognize' | 'intel_ink_recognize'> {
  return {
    intel_ocr_recognize: ({ request }) => {
      state.need('ocr');
      const wanted = request.language;
      if (wanted && !wanted.toLowerCase().startsWith('en'))
        reject('languageUnavailable', `no recognizer for ${wanted}`);
      const words = [
        { text: 'Sample', bounds: NO_BOUNDS },
        { text: 'text', bounds: NO_BOUNDS },
      ];
      const line = { text: 'Sample text', bounds: NO_BOUNDS, words };
      return options.ocr ?? { language: 'en-US', lines: [line], angle: null };
    },
    intel_ink_recognize: ({ request }) => {
      state.need('handwriting');
      if (options.ink) return options.ink;
      if (request.strokes.length === 0) return { lines: [] };
      const word = { text: 'sample', alternates: [], strokes: request.strokes.map((s) => s.key), bounds: NO_BOUNDS };
      return { lines: [{ text: 'sample', bounds: NO_BOUNDS, words: [word] }] };
    },
  };
}

/** Simple stand-ins for the transcript tools: sentences with "decided" or "will" are picked out. */
function transcriptHandlers(
  state: FakeState,
): Pick<Handlers, 'intel_ink_tidy' | 'intel_action_items' | 'intel_chapters' | 'intel_vocabulary_offer'> {
  return {
    intel_ink_tidy: () => {
      state.need('handwriting');
      return { moves: [], bounds: null };
    },
    intel_action_items: ({ request }) => {
      state.need('summaries');
      return request.transcript.segments.flatMap((segment, index) =>
        sentencesOf(segment.text).flatMap<ActionItem>((s) => {
          const kind = /\b(decided|agreed)\b/i.test(s.text)
            ? 'decision'
            : /\b(will|need to)\b/i.test(s.text)
              ? 'task'
              : null;
          return kind ? [{ kind, text: s.text, segment: index, startMs: segment.startMs, owner: null, due: null }] : [];
        }),
      );
    },
    intel_chapters: ({ request }) => {
      state.need('summaries');
      const segments = request.transcript.segments;
      if (segments.length === 0) return [];
      const text = segments.map((s) => s.text).join(' ');
      const keywords = keywordsOf(text, 5).map((k) => k.text);
      const title = keywords.slice(0, 2).join(' and ');
      return [
        {
          startMs: segments[0].startMs,
          endMs: segments[segments.length - 1].endMs,
          firstSegment: 0,
          lastSegment: segments.length - 1,
          title: title.charAt(0).toUpperCase() + title.slice(1),
          keywords,
        },
      ];
    },
    intel_vocabulary_offer: ({ request }) => {
      state.need('transcription');
      const { original, fixed } = request;
      const known = request.vocabulary
        .split('\n')
        .some((line) => line.split('|')[0].trim().toLowerCase() === fixed.toLowerCase());
      const caseOnly = original.toLowerCase() === fixed.toLowerCase();
      const distinctive = /[A-Z]/.test(fixed.slice(1)) || fixed.length >= 7;
      return known || (caseOnly && !distinctive) ? null : { term: fixed, heardAs: original };
    },
  };
}

function textHandlers(state: FakeState): Pick<Handlers, 'intel_summarize' | 'intel_keywords'> {
  return {
    intel_summarize: ({ request }): Summary => {
      state.need('summaries');
      const all = sentencesOf(request.text);
      const limit = request.options?.maxSentences ?? 3;
      const picked = all.slice(0, limit).map((s, i) => ({
        text: s.text,
        span: { start: s.start, end: s.start + s.text.length },
        score: 1 / (i + 1),
      }));
      return { language: request.options?.language ?? 'en', sentences: picked, inputSentences: all.length };
    },
    intel_keywords: ({ request }) => {
      state.need('summaries');
      return keywordsOf(request.text, request.options?.maxKeywords ?? 8);
    },
  };
}

/** One chunk per sentence, then `finished`, as the Rust hub answers each pull. A session that is over is gone. */
function pullChunk(state: FakeState, sessionId: string): ReadAloudNotice {
  const session = state.sessions.get(sessionId);
  if (!session) reject('canceled', `there is no read-aloud session ${sessionId}`);
  const piece = session.pieces[session.next];
  if (!piece) {
    state.sessions.delete(sessionId);
    return { kind: 'finished' };
  }
  const span = { start: piece.start, end: piece.start + piece.text.length };
  const index = session.next++;
  return { kind: 'chunk', index, total: session.pieces.length, span, ...state.storeClip(piece.text) };
}

type SpeechCommands =
  | 'intel_speech_voices'
  | 'intel_speech_synthesize'
  | 'intel_read_aloud_start'
  | 'intel_read_aloud_next'
  | 'intel_read_aloud_cancel'
  | 'intel_clip_audio';

function speechHandlers(state: FakeState): Pick<Handlers, SpeechCommands> {
  return {
    intel_speech_voices: () => {
      state.need('readAloud');
      return [VOICE];
    },
    intel_speech_synthesize: ({ request }) => {
      state.need('readAloud');
      return state.storeClip(request.text);
    },
    intel_read_aloud_start: ({ request }) => {
      state.need('readAloud');
      const sessionId = state.nextId('session');
      const pieces = sentencesOf(request.text);
      if (pieces.length === 0) reject('invalidInput', 'there is no text to read');
      state.sessions.set(sessionId, { pieces, next: 0 });
      return { sessionId, totalChunks: pieces.length };
    },
    intel_read_aloud_next: ({ sessionId }) => pullChunk(state, sessionId),
    intel_read_aloud_cancel: ({ sessionId }) => {
      state.sessions.delete(sessionId);
      return null;
    },
    intel_clip_audio: ({ clipId }) => {
      const bytes = state.clips.get(clipId);
      if (!bytes) reject('invalidInput', `there is no clip ${clipId}`);
      state.clips.delete(clipId);
      return bytes;
    },
  };
}

export function createFakeIntelTransport(options: FakeIntelOptions = {}): FakeIntelTransport {
  const calls: string[] = [];
  const state = createState(options);
  const ext = createFakeExt();
  const handlers: Handlers = {
    ...statusHandlers(state, options),
    ...recognitionHandlers(state, options),
    ...textHandlers(state),
    ...transcriptHandlers(state),
    ...speechHandlers(state),
    intel_ext_call: ({ request }) => ext.handle(request),
  };
  return {
    calls,
    ext,
    setSettings: (patch) => Object.assign(state.settings, patch),
    invoke: async (command, args) => {
      calls.push(command);
      return (handlers[command] as (a: typeof args) => IntelCommands[typeof command]['result'])(args);
    },
  };
}
