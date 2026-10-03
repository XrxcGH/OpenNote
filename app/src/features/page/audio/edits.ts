// Trimming a finished recording (Phase 9). An edit writes a new recording under new asset names and leaves the old
// files alone; the new entry takes the old one's place in the block, the page is saved, and only then do the old
// files go (crates/media/src/edit/README.md). Flags and text marks name the recording by its ID, which the edit
// keeps, so they still find their audio.
import type { RecordingEntry } from '../../../core/audio';
import { t } from '../../../strings/t';
import { announce, confirm, showToast } from '../../../ui';
import { shownPage as shownOpenPage } from '../history/shown';
import { writeEntry } from './blocks';
import { describeError, platformAudio } from './controller';
import { clockNs } from './format';
import { closePlayback } from './playback';

/** The start of a part to remove, in nanoseconds into the audio, by recording. */
const partStarts = new Map<string, number>();
export const partStart = (recording: string) => partStarts.get(recording);
export function markPartStart(recording: string, positionNs: number): void {
  partStarts.set(recording, positionNs);
  announce(t('audio.block.removeStart', { time: clockNs(positionNs) }));
}

async function replace(block: string, pageId: string, old: RecordingEntry, next: RecordingEntry): Promise<void> {
  const audio = platformAudio();
  const dir = await audio.assetsDir(pageId);
  await writeEntry(pageId, block, next, { track: 'finished', drop: old });
  await shownOpenPage.get()?.saveNow();
  await audio.deleteFiles(dir, old).catch(() => undefined);
}

/** Trims the silence at the start and end. */
export async function trimSilence(block: string, pageId: string, entry: RecordingEntry): Promise<void> {
  const audio = platformAudio();
  try {
    const dir = await audio.assetsDir(pageId);
    await closePlayback();
    const edited = await audio.trimSilence(dir, entry);
    if (!edited) return void announce(t('audio.announce.nothingToTrim'));
    await replace(block, pageId, entry, edited.entry);
    announce(t('audio.announce.trimmed', { time: clockNs(edited.durationNs) }));
  } catch (error) {
    showToast({ message: describeError(error), tone: 'danger' });
  }
}

/** Removes the part from the marked start up to `endNs`, after asking. */
export async function removePart(block: string, pageId: string, entry: RecordingEntry, endNs: number): Promise<void> {
  const startNs = partStarts.get(entry.id);
  if (startNs === undefined || endNs <= startNs) return;
  const ok = await confirm({
    title: t('audio.block.removeConfirm'),
    body: t('audio.block.removeBody', { from: clockNs(startNs), to: clockNs(endNs) }),
    confirmLabel: t('audio.block.removeAction'),
    cancelLabel: t('audio.block.cancel'),
    danger: true,
  });
  if (!ok) return;
  const audio = platformAudio();
  try {
    const dir = await audio.assetsDir(pageId);
    await closePlayback();
    const edited = await audio.removePart(dir, entry, startNs, endNs);
    partStarts.delete(entry.id);
    await replace(block, pageId, entry, edited.entry);
    announce(t('audio.announce.trimmed', { time: clockNs(edited.durationNs) }));
  } catch (error) {
    showToast({ message: describeError(error), tone: 'danger' });
  }
}
