// The seam for a speech engine. Making a transcript from the sound of a recording is the job of the on-device
// transcriber (the intelligence lane registers it when it ships). Nothing here recognizes speech: the screens ask this
// registry for an engine, and when there is none they say so and offer to add a transcript from text or captions.
import type { RecordingEntry } from '../../../../core/audio';
import type { Segment } from './model';

export interface TranscribeRequest {
  /** The page's `assets` folder, which holds the recording's files. */
  assetsDir: string;
  /** The recording, with the tracks to transcribe: the original's, or the enhanced copy's. */
  entry: RecordingEntry;
  /** Reports how far along it is, from 0 to 1. */
  onProgress?(fraction: number): void;
  /** Stops the job; the promise then rejects. */
  signal?: AbortSignal;
  /** False for work the person didn't ask for just now: the engine then never asks or shows anything. */
  interactive?: boolean;
}

export interface TranscribeResult {
  language: string | null;
  /** Times are positions in the recording's audio. `speaker` is 1, 2, ... when the engine can tell voices apart. */
  segments: Segment[];
}

export interface TranscriptEngine {
  id: string;
  /** True when the engine sends the audio to a cloud service, so it waits while Work offline is on. */
  cloud?: boolean;
  transcribe(request: TranscribeRequest): Promise<TranscribeResult>;
}

let engine: TranscriptEngine | null = null;

/** Registers the engine. Returns a function that removes it. */
export function registerTranscriptEngine(next: TranscriptEngine): () => void {
  engine = next;
  return () => {
    if (engine === next) engine = null;
  };
}

export const currentEngine = (): TranscriptEngine | null => engine;
