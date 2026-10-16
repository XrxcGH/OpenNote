// Flags on a recording (Phase 9): dropping, renaming, and removing them. A flag lives in its recording's entry, so
// each change saves the entry in the recording's block.
import { Flags } from '../../../core/audio';
import type { RecordingEntry } from '../../../core/audio';
import { newId } from '../../../editor/ids';
import { announce } from '../../../ui';
import { t } from '../../../strings/t';
import { writeEntry } from './blocks';
import { clockNs } from './format';
import { refreshIndex } from './playback';

async function save(
  page: string,
  block: string,
  entry: RecordingEntry,
  change: (flags: Flags) => void,
): Promise<RecordingEntry> {
  const flags = Flags.fromEntries([entry]);
  change(flags);
  const next = flags.into(entry);
  await writeEntry(page, block, next);
  refreshIndex(next);
  return next;
}

/** Drops a flag at a capture time of a finished recording, such as the moment that plays. */
export async function addFlag(
  page: string,
  block: string,
  entry: RecordingEntry,
  captureNs: number,
  positionNs: number,
) {
  const next = await save(page, block, entry, (flags) => void flags.add(entry.id, captureNs, newId));
  announce(t('audio.announce.flagged', { time: clockNs(positionNs) }));
  return next;
}

export const renameFlag = (page: string, block: string, entry: RecordingEntry, id: string, label: string) =>
  save(page, block, entry, (flags) => void flags.rename(id, label));

export const removeFlag = (page: string, block: string, entry: RecordingEntry, id: string) =>
  save(page, block, entry, (flags) => void flags.remove(id));
