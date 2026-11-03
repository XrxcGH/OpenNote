// What a recording block stands for, read without the page (Phase 9): its entry, and how long it ran.
import type { RecordingEntry } from '../../../core/audio';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { entryOf } from './entries';

/** Frames a second in a track's timeline (crates/media/src/audio/timeline.rs). */
const FRAMES_PER_SECOND = 48_000;

/**
 * The recorded time of an entry: its run less the pauses and the parts removed. Removing a part from the middle
 * leaves a hole in the tracks' capture time that is not a pause, so the frames the tracks hold count too: without
 * them the block kept the length from before the removal.
 */
export function activeNs(entry: RecordingEntry): number {
  const run = Math.max(0, entry.endedNs - entry.startedNs);
  const holes = entry.pauses.reduce((sum, hole) => sum + Math.max(0, hole.resumedNs - hole.pausedNs), 0);
  const timed = Math.max(0, run - holes);
  const frames = Math.max(0, ...entry.tracks.map((track) => track.timeline?.frames ?? 0));
  return frames > 0 ? Math.min(timed, Math.round((frames / FRAMES_PER_SECOND) * 1e9)) : timed;
}

/**
 * Where a capture time sits in the audio a person plays: its time since the start, less the pauses before it. A
 * flag dropped after a pause would otherwise point past the end of the recording.
 */
export function positionOfCapture(entry: RecordingEntry, captureNs: number): number {
  let paused = 0;
  for (const hole of entry.pauses) {
    if (hole.pausedNs >= captureNs) continue;
    paused += Math.max(0, Math.min(hole.resumedNs, captureNs) - hole.pausedNs);
  }
  return Math.max(0, captureNs - entry.startedNs - paused);
}

/** The name the person gave a recording, or null. */
export function nameOf(entry: RecordingEntry): string | null {
  const name = entry['name'];
  return typeof name === 'string' && name.trim() !== '' ? name : null;
}

/** What a reader that doesn't know the block shows. It can't change, so it doesn't name the length. */
export const fallbackFor = () => ({ markdown: t('audio.block.fallback') });

/** The ID of the recording a block stands for. */
export const recordingIdOf = (block: BlockJson): string | null =>
  typeof block.data.recording === 'string' ? block.data.recording : null;

export function dataOf(block: BlockJson): { entry: RecordingEntry } | null {
  const entry = entryOf(recordingIdOf(block));
  return entry ? { entry } : null;
}
