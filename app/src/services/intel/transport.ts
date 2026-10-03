// What the client needs from the shell: invoke a command. The Tauri platform will provide one over `invoke`
// (platform/tauri/invoke.ts), and tests and the web platform use the fake in fake.ts. Read aloud pulls its chunks
// with a command too, so no event is needed. Command names follow <domain>_<verb> and arguments are camelCase, as the
// rest of the app's commands do (ARCHITECTURE.md section 6.4).

import type {
  ActionItem,
  ActionItemsRequest,
  Chapter,
  ChaptersRequest,
  FeatureStatus,
  InkRecognition,
  InkRequest,
  Keyword,
  KeywordsRequest,
  OcrRequest,
  OcrResult,
  ReadAloudNotice,
  ReadAloudRequest,
  ReadAloudStarted,
  SpeechClip,
  SummarizeRequest,
  Summary,
  SynthesizeRequest,
  TidyPlan,
  TidyRequest,
  VocabularyOffer,
  VocabularyOfferRequest,
  Voice,
} from './types';

type None = Record<string, never>;

/** The bytes of a clip as a transport hands them over: raw bytes, or numbers when only JSON is available. */
export type RawBytes = ArrayBuffer | Uint8Array | number[];

/** Every intel command: its arguments and what it returns. */
export interface IntelCommands {
  /** Which features are on, and whether an engine exists for each. */
  intel_status: { args: None; result: FeatureStatus[] };
  /** The OCR languages installed on this computer, as language tags. */
  intel_ocr_languages: { args: None; result: string[] };
  intel_ocr_recognize: { args: { request: OcrRequest }; result: OcrResult };
  intel_ink_recognize: { args: { request: InkRequest }; result: InkRecognition };
  /** Plans a tidy of recognized handwriting. Needs the `handwriting` feature. */
  intel_ink_tidy: { args: { request: TidyRequest }; result: TidyPlan };
  intel_summarize: { args: { request: SummarizeRequest }; result: Summary };
  intel_keywords: { args: { request: KeywordsRequest }; result: Keyword[] };
  /** Tasks and decisions in a transcript. Needs the `summaries` feature. */
  intel_action_items: { args: { request: ActionItemsRequest }; result: ActionItem[] };
  /** Titled chapters for a transcript. Needs the `summaries` feature. */
  intel_chapters: { args: { request: ChaptersRequest }; result: Chapter[] };
  /** A term to offer adding to the custom vocabulary, or null. Needs the `transcription` feature. */
  intel_vocabulary_offer: { args: { request: VocabularyOfferRequest }; result: VocabularyOffer | null };
  intel_speech_voices: { args: None; result: Voice[] };
  /** Synthesizes one short text. Fetch the sound with intel_clip_audio. */
  intel_speech_synthesize: { args: { request: SynthesizeRequest }; result: SpeechClip };
  /** Starts reading a page. Nothing is read beyond the first few chunks until the client pulls them. */
  intel_read_aloud_start: { args: { request: ReadAloudRequest }; result: ReadAloudStarted };
  /** The session's next notice. A chunk's sound waits under its clip ID. After `finished` or `failed` it is over. */
  intel_read_aloud_next: { args: { sessionId: string }; result: ReadAloudNotice };
  /** Ends a session and drops its clips. */
  intel_read_aloud_cancel: { args: { sessionId: string }; result: null };
  /** The WAV file of a clip. The command layer forgets the clip once it has handed over the bytes. */
  intel_clip_audio: { args: { clipId: string }; result: RawBytes };
}

export type IntelCommand = keyof IntelCommands;

export interface IntelTransport {
  invoke<K extends IntelCommand>(command: K, args: IntelCommands[K]['args']): Promise<IntelCommands[K]['result']>;
}
