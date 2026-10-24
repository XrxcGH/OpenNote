// What a recording block stands for, read without the page (Phase 9): its entry, and how long it ran.
import type { RecordingEntry } from '../../../core/audio';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { entryOf } from './entries';

/** The recorded time of an entry: its run less the pauses and the parts removed. */
export function activeNs(entry: RecordingEntry): number {
  const run = Math.max(0, entry.endedNs - entry.startedNs);
  const holes = entry.pauses.reduce((sum, hole) => sum + Math.max(0, hole.resumedNs - hole.pausedNs), 0);
  return Math.max(0, run - holes);
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
