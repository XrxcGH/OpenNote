// Ink replay: plays strokes back in the order they were written, from the time each one stores. Long pauses can be
// shortened, so a page written over an hour replays in minutes. When the page has a recording, `audioSeekFor` says
// where its audio belongs for any moment of the replay, so the sound can play along.
//
// Times here are Unix milliseconds for the page ("real") and milliseconds from the first stroke for the replay.

import { partitionPoint, type PositionMap } from './positions';
import { captureOf } from './strokes';
import type { RecordingEntry } from './types';

export interface ReplayStroke {
  id: string;
  startMs: number;
  durationMs: number;
}

export interface ReplayOptions {
  /** Pauses between strokes longer than this are cut to it. Null keeps every pause. The default is one second. */
  maxGapMs?: number | null;
}

export const DEFAULT_MAX_GAP_MS = 1_000;

/** What is on the page at one moment of the replay. */
export interface ReplayFrame {
  /** The strokes that are finished, in the order they were started. */
  done: string[];
  /** The strokes being drawn, with how far each one has come, from 0 to 1. */
  drawing: { id: string; progress: number }[];
}

/** A stretch where replay time passes at a steady rate against real time. */
interface Piece {
  realStart: number;
  realEnd: number;
  replayStart: number;
  /** Replay milliseconds for each real millisecond: 1, or less where a pause was shortened. */
  rate: number;
}

const replayEnd = (piece: Piece): number => piece.replayStart + (piece.realEnd - piece.realStart) * piece.rate;

export class InkReplay {
  readonly strokes: readonly ReplayStroke[];
  /** The length of the replay at normal speed. */
  readonly durationMs: number;
  private readonly pieces: Piece[] = [];

  constructor(strokes: Iterable<ReplayStroke>, options: ReplayOptions = {}) {
    this.strokes = [...strokes].sort((a, b) => a.startMs - b.startMs);
    const maxGap = options.maxGapMs === undefined ? DEFAULT_MAX_GAP_MS : options.maxGapMs;
    this.durationMs = this.buildPieces(maxGap);
  }

  private buildPieces(maxGap: number | null): number {
    const first = this.strokes[0];
    if (!first) return 0;
    let replay = 0;
    let covered = first.startMs;
    let pieceStart = first.startMs;
    const close = (end: number): void => {
      if (end > pieceStart) {
        this.pieces.push({ realStart: pieceStart, realEnd: end, replayStart: replay, rate: 1 });
        replay += end - pieceStart;
      }
    };
    for (const stroke of this.strokes) {
      const gap = stroke.startMs - covered;
      if (maxGap !== null && gap > maxGap) {
        close(covered);
        this.pieces.push({ realStart: covered, realEnd: stroke.startMs, replayStart: replay, rate: maxGap / gap });
        replay += maxGap;
        pieceStart = stroke.startMs;
      }
      covered = Math.max(covered, stroke.startMs + Math.max(stroke.durationMs, 0));
    }
    close(covered);
    return replay;
  }

  /** The replay time of a real time. A time before the first stroke is 0, and one after the last is the end. */
  replayTimeOf(realMs: number): number {
    const at = partitionPoint(this.pieces, (piece) => piece.realEnd <= realMs);
    const piece = this.pieces[at];
    if (!piece) return this.durationMs;
    return Math.max(piece.replayStart + (realMs - piece.realStart) * piece.rate, 0);
  }

  /** The real time of a replay time, which the audio and text edits of that moment share. */
  realTimeOf(replayMs: number): number {
    if (this.pieces.length === 0) return 0;
    const at = partitionPoint(this.pieces, (piece) => replayEnd(piece) <= replayMs);
    const piece = this.pieces[Math.min(at, this.pieces.length - 1)] as Piece;
    return piece.realStart + (replayMs - piece.replayStart) / piece.rate;
  }

  /** What is drawn at a replay time. */
  frameAt(replayMs: number): ReplayFrame {
    const atEnd = replayMs >= this.durationMs;
    const real = this.realTimeOf(Math.min(Math.max(replayMs, 0), this.durationMs));
    const frame: ReplayFrame = { done: [], drawing: [] };
    for (const stroke of this.strokes) {
      if (stroke.startMs > real) break;
      const end = stroke.startMs + Math.max(stroke.durationMs, 0);
      if (atEnd || end <= real) frame.done.push(stroke.id);
      else frame.drawing.push({ id: stroke.id, progress: (real - stroke.startMs) / (end - stroke.startMs) });
    }
    return frame;
  }

  /** The replay time at which the next stroke starts, or null after the last one. Steps with the arrow keys. */
  nextStrokeStart(replayMs: number): number | null {
    for (const stroke of this.strokes) {
      const start = this.replayTimeOf(stroke.startMs);
      if (start > replayMs + 0.5) return start;
    }
    return null;
  }

  /** The replay time at which the previous stroke started, or null before the first. */
  previousStrokeStart(replayMs: number): number | null {
    let found: number | null = null;
    for (const stroke of this.strokes) {
      const start = this.replayTimeOf(stroke.startMs);
      if (start >= replayMs - 0.5) break;
      found = start;
    }
    return found;
  }

  /**
   * Where the audio of `recording` belongs for a replay time, or null if the recording has no clock anchor. With
   * pauses shortened the audio cannot play straight through, so a screen seeks at each stroke or turns shortening off.
   */
  audioSeekFor(
    recording: RecordingEntry,
    map: PositionMap,
    replayMs: number,
  ): { positionNs: number; exact: boolean } | null {
    if (!recording.clock) return null;
    return map.locate(captureOf(recording.clock, this.realTimeOf(replayMs)));
  }
}
