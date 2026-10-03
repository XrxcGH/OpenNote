// The interface's way to ask the Rust intel crate for text in images, handwriting, summaries, and read aloud.
// Every method rejects only with IntelClientError. A feature the person has not turned on rejects with the code
// 'disabled' and the feature to offer, before anything runs. Nothing here touches the network.

import { toIntelError } from './errors';
import { pixelSource } from './image';
import { startReadAloud, toBytes } from './readAloud';
import type { ReadAloudSession } from './readAloud';
import type { IntelCommand, IntelCommands, IntelTransport } from './transport';
import type {
  ActionItem,
  Chapter,
  ChapterOptions,
  FeatureStatus,
  ImagePixels,
  InkRecognition,
  InkStroke,
  Keyword,
  KeywordOptions,
  OcrResult,
  SpeakOptions,
  SpeechInfo,
  StrokeKind,
  Summary,
  SummaryOptions,
  TidyOperation,
  TidyPlan,
  Transcript,
  VocabularyOffer,
  Voice,
} from './types';

/** A short text made into sound. */
export interface SpokenText {
  /** A WAV file. */
  audio: Uint8Array;
  info: SpeechInfo;
}

export interface IntelClient {
  /** Which features are on, and whether an engine exists for each. For the settings screen. */
  status(): Promise<FeatureStatus[]>;
  /** The OCR languages installed on this computer, as language tags. */
  ocrLanguages(): Promise<string[]>;
  /** Reads the text in an image, with a box for every word. Needs the `ocr` feature. */
  recognizeImage(image: ImagePixels, options?: { language?: string }): Promise<OcrResult>;
  /** Reads handwriting, and says which strokes made each word. Needs the `handwriting` feature. */
  recognizeInk(strokes: InkStroke[], options?: { kind?: StrokeKind }): Promise<InkRecognition>;
  /**
   * Plans a tidy of handwriting that was already recognized: level the lines, even out the spacing, or wrap to a
   * width. Nothing changes until you apply the moves. Needs the `handwriting` feature.
   */
  tidyInk(strokes: InkStroke[], recognition: InkRecognition, operation: TidyOperation): Promise<TidyPlan>;
  /** Picks the sentences that best stand for the text. Needs the `summaries` feature. */
  summarize(text: string, options?: SummaryOptions): Promise<Summary>;
  /** Finds the words and phrases that best stand for the text. Needs the `summaries` feature. */
  keywords(text: string, options?: KeywordOptions): Promise<Keyword[]>;
  /** Suggests the tasks and decisions in a transcript. Needs the `summaries` feature. */
  actionItems(transcript: Transcript): Promise<ActionItem[]>;
  /** Cuts a transcript into titled chapters. Needs the `summaries` feature. */
  chapters(transcript: Transcript, options?: ChapterOptions): Promise<Chapter[]>;
  /** A term to offer adding to the custom vocabulary after the person fixed a word, or null. Needs `transcription`. */
  vocabularyOffer(vocabulary: string, original: string, fixed: string): Promise<VocabularyOffer | null>;
  /** The voices installed on this computer. Needs the `readAloud` feature. */
  voices(): Promise<Voice[]>;
  /** Makes a short text into sound, for a single phrase. Use readAloud for a page. */
  speak(text: string, options?: SpeakOptions): Promise<SpokenText>;
  /** Reads a page aloud, chunk by chunk, with the time of every word. Needs the `readAloud` feature. */
  readAloud(text: string, options?: SpeakOptions & { maxChunkChars?: number }): Promise<ReadAloudSession>;
}

export function createIntelClient(transport: IntelTransport): IntelClient {
  async function call<K extends IntelCommand>(command: K, args: IntelCommands[K]['args']) {
    try {
      return await transport.invoke(command, args);
    } catch (error) {
      throw toIntelError(error);
    }
  }
  const none = {} as Record<string, never>;

  return {
    status: () => call('intel_status', none),
    ocrLanguages: () => call('intel_ocr_languages', none),
    recognizeImage: (image, options = {}) =>
      call('intel_ocr_recognize', {
        request: { source: pixelSource(image), ...withValue('language', options.language) },
      }),
    recognizeInk: (strokes, options = {}) =>
      call('intel_ink_recognize', { request: { strokes, ...withValue('kind', options.kind) } }),
    tidyInk: (strokes, recognition, operation) =>
      call('intel_ink_tidy', { request: { strokes, recognition, operation } }),
    actionItems: (transcript) => call('intel_action_items', { request: { transcript } }),
    chapters: (transcript, options) =>
      call('intel_chapters', { request: { transcript, ...withValue('options', options) } }),
    vocabularyOffer: (vocabulary, original, fixed) =>
      call('intel_vocabulary_offer', { request: { vocabulary, original, fixed } }),
    summarize: (text, options) => call('intel_summarize', { request: { text, ...withValue('options', options) } }),
    keywords: (text, options) => call('intel_keywords', { request: { text, ...withValue('options', options) } }),
    voices: () => call('intel_speech_voices', none),
    async speak(text, options) {
      const clip = await call('intel_speech_synthesize', { request: { text, ...withValue('speak', options) } });
      const raw = await call('intel_clip_audio', { clipId: clip.clipId });
      return { audio: toBytes(raw), info: clip.info };
    },
    readAloud(text, options = {}) {
      const { maxChunkChars, ...speak } = options;
      return startReadAloud(transport, {
        text,
        ...withValue('speak', Object.keys(speak).length > 0 ? speak : undefined),
        ...withValue('maxChunkChars', maxChunkChars),
      });
    },
  };
}

/** `{ [key]: value }`, or nothing when the value is left out, so the request holds only what the caller set. */
function withValue<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}
