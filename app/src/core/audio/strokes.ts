// Strokes: every stroke stores its start time as Unix milliseconds (spec 9.3), so handwriting needs no new data to
// link to a recording. The recording's clock anchor turns that time into a capture time. The TypeScript twin of
// `Entry::stroke` in crates/media/src/stamps/index.rs.

import type { ClockAnchor, RecordingEntry, StampEntry } from './types';

/** The capture time of a Unix time, by the recording's clock anchor. */
export function captureOf(anchor: ClockAnchor, unixMs: number): number {
  return Math.max(anchor.captureNs + (unixMs - anchor.unixMs) * 1_000_000, 0);
}

/** The Unix time of a capture time, in whole milliseconds, rounded down. */
export function unixOf(anchor: ClockAnchor, captureNs: number): number {
  return anchor.unixMs + Math.floor((captureNs - anchor.captureNs) / 1_000_000);
}

export interface StrokeTime {
  id: string;
  startMs: number;
  durationMs: number;
}

/**
 * The stamp entry for a stroke, or null when the stroke began outside the recording or the recording has no clock
 * anchor. A stroke that began before the recording has no audio to hear. One that was still going when the
 * recording ended keeps its start.
 */
export function strokeEntry(recording: RecordingEntry, stroke: StrokeTime): StampEntry | null {
  if (!recording.clock) return null;
  const startNs = captureOf(recording.clock, stroke.startMs);
  if (stroke.startMs < unixOf(recording.clock, recording.startedNs) || startNs > recording.endedNs) return null;
  return {
    recording: recording.id,
    startNs,
    endNs: startNs + Math.max(stroke.durationMs, 0) * 1_000_000,
    target: { type: 'stroke', id: stroke.id },
  };
}

/** The entries for all the strokes of a page, in every recording of the page. A stroke can land in several. */
export function strokeEntries(recordings: readonly RecordingEntry[], strokes: Iterable<StrokeTime>): StampEntry[] {
  const entries: StampEntry[] = [];
  for (const stroke of strokes) {
    for (const recording of recordings) {
      const found = strokeEntry(recording, stroke);
      if (found) entries.push(found);
    }
  }
  return entries;
}
