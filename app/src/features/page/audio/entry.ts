// What a recording block stands for, read without the page (Phase 9): its entry, and how long it ran.
import type { RecordingEntry, Timeline } from '../../../core/audio';
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
  const timeline = entry.tracks.find((track) => track.timeline.anchors.length > 0)?.timeline;
  if (timeline) return timelinePosition(timeline, captureNs);
  let paused = 0;
  for (const hole of entry.pauses) {
    if (hole.pausedNs >= captureNs) continue;
    paused += Math.max(0, Math.min(hole.resumedNs, captureNs) - hole.pausedNs);
  }
  return Math.max(0, captureNs - entry.startedNs - paused);
}

const NS_PER_FRAME = 1e9 / 48_000;

/**
 * A capture time's place in the track. Each anchor starts a stretch of frames at a capture time, and the gap before the
 * next anchor is a pause or a removed part. A time in a gap sits where the audio goes on, and one past the end at the
 * end, so a flag never points past the clip after a part is removed.
 */
function timelinePosition(timeline: Timeline, captureNs: number): number {
  const { anchors, frames } = timeline;
  let frame = 0;
  anchors.forEach((anchor, index) => {
    if (anchor.timeNs > captureNs) return;
    const end = anchors[index + 1]?.frame ?? frames;
    frame = Math.min(anchor.frame + (captureNs - anchor.timeNs) / NS_PER_FRAME, end);
  });
  return Math.round(Math.min(frame, frames) * NS_PER_FRAME);
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
