// The shapes that cross between the interface and the Rust `opennote-intel` crate (crates/intel/src/wire.rs).
// They are written by hand and checked against samples the Rust tests write to crates/intel/tests/fixtures/wire,
// so a change on either side fails a test. Offsets into text count UTF-16 units, the indexes of a JavaScript
// string. Nothing here is sent over a network: every call stays on the device.

/** A feature the person turns on. Every one starts off. */
export type Feature = 'ocr' | 'handwriting' | 'readAloud' | 'summaries' | 'transcription';

export const FEATURES: readonly Feature[] = ['ocr', 'handwriting', 'readAloud', 'summaries', 'transcription'];

export type IntelSettings = Record<Feature, boolean>;

/** What the settings screen shows for one feature. */
export interface FeatureStatus {
  feature: Feature;
  /** The person turned it on. */
  enabled: boolean;
  /** An engine exists on this computer. */
  available: boolean;
  /** A sentence saying why not, when it is not available. */
  unavailableReason: string | null;
}

export type IntelErrorCode =
  | 'unsupported'
  | 'languageUnavailable'
  | 'voiceUnavailable'
  | 'imageTooLarge'
  | 'invalidInput'
  | 'deviceUnavailable'
  | 'modelMissing'
  | 'canceled'
  | 'audio'
  | 'engine'
  | 'platform'
  | 'disabled';

/** An error as the Rust crate reports it. */
export interface ErrorInfo {
  code: IntelErrorCode;
  /** For logs. The interface picks its own words from the code. */
  message: string;
  /** For 'disabled', the feature to offer to turn on. */
  feature: Feature | null;
}

/** A stretch of text, counted in UTF-16 units. `end` is not included. */
export interface Span {
  start: number;
  end: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Text in images

export type PixelFormat = 'rgba8' | 'gray8';

/** Decoded pixels, row by row from the top left with no padding. */
export interface ImagePixels {
  width: number;
  height: number;
  format: PixelFormat;
  pixels: Uint8Array | Uint8ClampedArray;
}

export interface OcrWord {
  text: string;
  /** In image pixels. */
  bounds: Rect;
}

export interface OcrLine {
  text: string;
  bounds: Rect;
  words: OcrWord[];
}

export interface OcrResult {
  /** The language tag the engine recognized in. */
  language: string;
  lines: OcrLine[];
  /** How far the text is tilted from horizontal, in degrees, when the engine says. */
  angle: number | null;
}

export type OcrSource = {
  kind: 'pixels';
  width: number;
  height: number;
  format: PixelFormat;
  /** Base64 of the pixel bytes. */
  pixels: string;
};

export interface OcrRequest {
  source: OcrSource;
  language?: string | null;
}

// Handwriting

/** `auto` lets the recognizer tell writing from drawing. `writing` trusts that every stroke is writing. */
export type StrokeKind = 'auto' | 'writing';

/** A point in page units, y growing downward. */
export type InkPoint = [x: number, y: number];

export interface InkStroke {
  /** The stroke's 26-character ID text, which comes back with each word. */
  key: string;
  /** With the stroke's own transform already applied. */
  points: InkPoint[];
}

export interface InkWord {
  text: string;
  /** Other readings, most likely first. */
  alternates: string[];
  /** The keys of the strokes that make up the word. */
  strokes: string[];
  bounds: Rect;
}

export interface InkLine {
  text: string;
  bounds: Rect;
  words: InkWord[];
}

export interface InkRecognition {
  lines: InkLine[];
}

export interface InkRequest {
  strokes: InkStroke[];
  kind?: StrokeKind;
}

// Summaries and keywords

export interface SummaryOptions {
  /** Default 3. */
  maxSentences?: number;
  /** A budget for all the sentences together. A sentence that would pass it is skipped. */
  maxChars?: number | null;
  /** A language tag, or left out to detect it. */
  language?: string | null;
}

export interface SummarySentence {
  /** The sentence as written, without a list marker. */
  text: string;
  /** Where it sits in the text that was sent. */
  span: Span;
  /** From 0 to 1. */
  score: number;
}

export interface Summary {
  language: string;
  /** In the order they appear in the text. */
  sentences: SummarySentence[];
  /** How many sentences the text had. */
  inputSentences: number;
}

export interface KeywordOptions {
  /** Default 8. */
  maxKeywords?: number;
  /** From 1 to 4. Default 3. */
  maxWords?: number;
  language?: string | null;
}

export interface Keyword {
  text: string;
  /** From 0 to 1, best first. */
  score: number;
  count: number;
}

export interface SummarizeRequest {
  text: string;
  options?: SummaryOptions;
}

export interface KeywordsRequest {
  text: string;
  options?: KeywordOptions;
}

// Read aloud

export type VoiceGender = 'female' | 'male' | 'unspecified';

export interface Voice {
  id: string;
  name: string;
  language: string;
  gender: VoiceGender;
}

export interface SpeakOptions {
  /** A voice id, or left out for the default voice. */
  voice?: string | null;
  /** Speed from 0.5 to 4. Default 1. */
  rate?: number;
  /** From 0 to 2. Default 1. */
  pitch?: number;
  /** From 0 to 1. Default 1. */
  volume?: number;
}

export type BoundaryKind = 'word' | 'sentence';

/** A word or sentence, when it is spoken, and where it is in the text. */
export interface Boundary {
  kind: BoundaryKind;
  startMs: number;
  /** When the next one of its kind starts, or the end of the sound for the last. */
  endMs: number;
  /** In the text that was synthesized. */
  text: Span;
}

export interface SpeechInfo {
  durationMs: number;
  /** In time order. */
  boundaries: Boundary[];
}

export interface SynthesizeRequest {
  text: string;
  speak?: SpeakOptions;
}

/** A synthesized clip held by the command layer until its sound is fetched. */
export interface SpeechClip {
  clipId: string;
  info: SpeechInfo;
}

export interface ReadAloudRequest {
  text: string;
  speak?: SpeakOptions;
  /** The longest chunk in characters. Left out for the default of 400. */
  maxChunkChars?: number | null;
}

export interface ReadAloudStarted {
  sessionId: string;
  totalChunks: number;
}

/** What one pull of a read-aloud session returns (`intel_read_aloud_next`). */
export type ReadAloudNotice =
  | { kind: 'chunk'; index: number; total: number; span: Span; info: SpeechInfo; clipId: string }
  | { kind: 'finished' }
  | { kind: 'failed'; error: ErrorInfo };

// Tidying handwriting

/** A 2D transform: a point (x, y) becomes (a*x + c*y + e, b*x + d*y + f). The order a stroke's transform uses. */
export type Affine = [a: number, b: number, c: number, d: number, e: number, f: number];

/** The change to one stroke's points, in page units. Combine it with the stroke's own transform. */
export interface StrokeMove {
  key: string;
  transform: Affine;
}

export type TidyOperation =
  /** Level each line by turning it a little. */
  | { kind: 'straighten' }
  /** Make the gaps between words alike, and the sizes of words alike. */
  | { kind: 'evenSpacing' }
  /** Wrap the writing to a width in page units. */
  | { kind: 'reflow'; width: number };

export interface TidyRequest {
  strokes: InkStroke[];
  /** What the recognizer made of the strokes, which groups them into words and lines. */
  recognition: InkRecognition;
  operation: TidyOperation;
}

/** The moves that carry out an operation. Nothing is changed until the interface applies them. */
export interface TidyPlan {
  /** One for each stroke that changes. */
  moves: StrokeMove[];
  /** The box around the moved strokes after the moves, or null when nothing moves. */
  bounds: Rect | null;
}

// Transcripts

export type TranscriptDevice = 'npu' | 'cpu';

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface Transcript {
  language: string | null;
  device: TranscriptDevice;
  segments: TranscriptSegment[];
}

export type ActionKind = 'task' | 'decision';

/** A suggestion. Nothing is added to a page without a click. */
export interface ActionItem {
  kind: ActionKind;
  /** The sentence as transcribed. */
  text: string;
  /** The transcript segment it came from. */
  segment: number;
  /** When that segment starts, so the item can link to the moment. */
  startMs: number;
  /** A named person responsible, such as "Maria". Null when the speaker takes it on or no one is named. */
  owner: string | null;
  /** The deadline as said, such as "by Friday". The interface parses it. */
  due: string | null;
}

export interface ChapterOptions {
  /** Default 12. */
  maxChapters?: number;
  /** The shortest chapter in milliseconds. Default 60000. */
  minChapterMs?: number;
  language?: string | null;
}

export interface Chapter {
  startMs: number;
  endMs: number;
  firstSegment: number;
  lastSegment: number;
  /** The best keywords, or empty when the chapter has none. Use your own words, such as "Part 2", then. */
  title: string;
  keywords: string[];
}

export interface ActionItemsRequest {
  transcript: Transcript;
}

export interface ChaptersRequest {
  transcript: Transcript;
  options?: ChapterOptions;
}

export interface VocabularyOfferRequest {
  /** The custom vocabulary in its plain-text form, one term to a line. */
  vocabulary: string;
  /** The word as the transcript had it. */
  original: string;
  /** The word as the person fixed it. */
  fixed: string;
}

/** A term worth adding to the custom vocabulary after the person fixed a word. */
export interface VocabularyOffer {
  term: string;
  heardAs: string;
}
