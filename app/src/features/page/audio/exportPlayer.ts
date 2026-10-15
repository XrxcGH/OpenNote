// The recordings of the shown page as a player in a web page export (Phase 9, Recording player in web page export).
// Each complete recording is mixed into an Opus file beside the web page, and every text block that was written while
// it ran gets the moment it was written, in seconds into the audio, so the exported page can highlight the note that
// matches what is playing and play from a note. The mixing is the host's; the moments are worked out here.
import type { RecordingEntry, TextMarksData } from '../../../core/audio';
import { playable } from '../../../core/audio';
import { activeNs } from './entry';
import { recordingBlocks, recordingIdOf } from './blocks';
import { platformAudio } from './controller';
import { entryOf } from './entries';
import { moreClient } from './moreClient';
import { shownLayer } from '../mount';

/** What the web page needs of one recording and its notes. */
export interface PreparedPlayer {
  readonly recordings: ReadonlyMap<string, { src: string; seconds: number }>;
  readonly moments: ReadonlyMap<string, number>;
}

/** Seconds into the audio of a capture time: the time since the start, less the pauses before it. */
export function positionSeconds(entry: RecordingEntry, captureNs: number): number {
  const paused = entry.pauses.reduce((sum, hole) => {
    if (captureNs <= hole.pausedNs) return sum;
    return sum + Math.min(captureNs, hole.resumedNs) - hole.pausedNs;
  }, 0);
  return Math.max(0, (captureNs - entry.startedNs - paused) / 1e9);
}

/** The moment a text block was first written during the recording, or null when it was not. */
export function momentOf(entry: RecordingEntry, marks: unknown): number | null {
  const data = marks as TextMarksData | undefined;
  if (!data || !Array.isArray(data.recordings) || !Array.isArray(data.marks)) return null;
  const starts = data.marks
    .filter((mark) => data.recordings[mark.recording] === entry.id && Number.isFinite(mark.startNs))
    .map((mark) => mark.startNs);
  if (starts.length === 0) return null;
  const seconds = positionSeconds(entry, Math.min(...starts));
  return Math.min(seconds, activeNs(entry) / 1e9);
}

/** The moments for every text block of the page that has marks of the recording. */
export function momentsFor(
  entry: RecordingEntry,
  blocks: readonly { id: string; type: string; data: Record<string, unknown> }[],
): Map<string, number> {
  const found = new Map<string, number>();
  for (const block of blocks) {
    if (block.type !== 'text') continue;
    const moment = momentOf(entry, block.data.marks);
    if (moment !== null) found.set(block.id, moment);
  }
  return found;
}

const baseName = (path: string) => path.split(/[\/]/).pop() ?? path;

/**
 * Makes the audio files beside the web page at `htmlPath` and describes the player. A recording that cannot be mixed
 * is left out, and the page keeps its notes without it. Resolves null when the page has no recordings.
 */
export async function preparePlayer(pageId: string, htmlPath: string): Promise<PreparedPlayer | null> {
  const blocks = recordingBlocks();
  if (blocks.length === 0) return null;
  const textBlocks = (shownLayer.get()?.blocks() ?? []).map((block) => ({
    id: block.id,
    type: block.type,
    data: block.data,
  }));
  const stem = htmlPath.replace(/\.[^.\/]*$/, '');
  const recordings = new Map<string, { src: string; seconds: number }>();
  const moments = new Map<string, number>();
  let number = 0;
  for (const block of blocks) {
    const id = recordingIdOf(block);
    const entry = entryOf(id);
    if (!id || !entry || entry.state === 'recording' || entry.tracks.length === 0) continue;
    const dest = `${stem}_audio${number === 0 ? '' : `_${number + 1}`}.opus`;
    try {
      const dir = await platformAudio().assetsDir(pageId);
      await (await moreClient()).exportAudio(dir, playable(entry), dest, 'opus');
    } catch {
      continue;
    }
    number += 1;
    recordings.set(id, { src: encodeURIComponent(baseName(dest)), seconds: activeNs(entry) / 1e9 });
    for (const [blockId, seconds] of momentsFor(entry, textBlocks)) if (!moments.has(blockId)) moments.set(blockId, seconds);
  }
  return recordings.size === 0 ? null : { recordings, moments };
}
