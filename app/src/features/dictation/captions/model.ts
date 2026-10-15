// What the caption strip shows (A2-25). The strip keeps the last few finished phrases and the rough reading of the
// phrase being said. Plain functions on plain data, so the rules are tested without a microphone.
import type { StreamUpdate } from '../../../platform/intelStream';

/** The most finished phrases kept on the strip. */
export const KEPT_LINES = 3;
/** Past this the captions are told to be late, in milliseconds. */
export const LATE_MS = 5000;
/** The most characters shown for one phrase, so a long one never fills the screen. */
export const MAX_LINE_CHARS = 220;

export interface Captions {
  lines: readonly string[];
  /** The phrase being said, rough. */
  partial: string;
  behindMs: number;
  /** Whether anyone has spoken since the strip opened. */
  heard: boolean;
}

export const EMPTY: Captions = { lines: [], partial: '', behindMs: 0, heard: false };

const clip = (text: string): string => (text.length <= MAX_LINE_CHARS ? text : `…${text.slice(-MAX_LINE_CHARS)}`);

export function reduceCaptions(state: Captions, update: StreamUpdate): Captions {
  switch (update.kind) {
    case 'partial':
      return { ...state, partial: clip(update.text), behindMs: update.behindMs, heard: true };
    case 'final':
      return {
        lines: [...state.lines, clip(update.text)].slice(-KEPT_LINES),
        partial: '',
        behindMs: update.behindMs,
        heard: true,
      };
    default:
      return state;
  }
}

/** Whether the captions trail the speech enough to say so. */
export const isLate = (state: Captions): boolean => state.behindMs >= LATE_MS;

/** The words on the strip, oldest first, ending with the rough phrase. */
export function shown(state: Captions): string[] {
  return state.partial ? [...state.lines.slice(-(KEPT_LINES - 1)), state.partial] : [...state.lines];
}
