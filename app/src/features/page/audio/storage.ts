// What recordings take (Phase 9, "Recording storage"). The host lists every recording in the open notebooks with its
// length and size. Two things can free space, and each asks first, saying how much: Compress writes a smaller copy
// that takes the original's place, and Remove audio deletes the audio but keeps the transcript, flags, and notes. Both
// save the page with the new entry before the old files go, so a crash never leaves a page that names missing files.
import { extrasOf, withoutEnhanced } from '../../../core/audio';
import type { CompressQuality, RecordingEntry, StoredRecording } from '../../../core/audio';
import { t } from '../../../strings/t';
import { announce, confirm, showToast } from '../../../ui';
import { shownPage as shownOpenPage } from '../history/shown';
import { dataOf, recordingBlocks, writeEntry } from './blocks';
import { describeError } from './controller';
import { deleteAudioFiles } from './edits';
import { entryOf } from './entries';
import { bytesText } from './format';
import { moreClient } from './moreClient';
import { closePlayback } from './playback';

export const scanStorage = async (): Promise<StoredRecording[]> => (await moreClient()).storageScan();

/** The entry as the page holds it now. The shown page's entries may have changes the disk copy doesn't yet. */
function liveEntry(stored: StoredRecording): RecordingEntry {
  return shownOpenPage.get()?.id === stored.page ? (entryOf(stored.entry.id) ?? stored.entry) : stored.entry;
}

/** The block of a recording on the shown page. Another page needs none, since it is opened just for the change. */
function blockOf(stored: StoredRecording): string | null {
  if (shownOpenPage.get()?.id !== stored.page) return '';
  const block = recordingBlocks().find((candidate) => dataOf(candidate)?.entry.id === stored.entry.id);
  return block?.id ?? null;
}

/** What Compress at this quality frees. */
export const freedBy = (stored: StoredRecording, quality: CompressQuality): number =>
  quality === 'smallest' ? stored.freesSmallest : stored.freesSmaller;

async function saved(page: string): Promise<void> {
  if (shownOpenPage.get()?.id === page) await shownOpenPage.get()?.saveNow();
}

/** Compresses after asking. Answers whether anything changed. */
export async function compressStored(stored: StoredRecording, quality: CompressQuality): Promise<boolean> {
  const old = liveEntry(stored);
  const block = blockOf(stored);
  if (block === null) return false;
  const frees = freedBy(stored, quality);
  const ok = await confirm({
    title: t('audioMore.storage.compressTitle'),
    body: t('audioMore.storage.compressBody', {
      quality: t(quality === 'smallest' ? 'audioMore.storage.qualitySmallest' : 'audioMore.storage.qualitySmaller'),
      size: bytesText(frees),
    }),
    confirmLabel: t('audioMore.storage.compressAction'),
    cancelLabel: t('audioMore.storage.cancel'),
  });
  if (!ok) return false;
  try {
    await closePlayback();
    const dir = stored.assetsDir;
    const edited = await (await moreClient()).compress(dir, old, quality);
    await writeEntry(stored.page, block, withoutEnhanced(edited.entry), { track: 'finished', drop: old });
    await saved(stored.page);
    await deleteAudioFiles(dir, old);
    const message = t('audioMore.storage.compressed', { size: bytesText(frees) });
    announce(message);
    showToast({ message });
    return true;
  } catch (error) {
    showToast({ message: describeError(error), tone: 'danger' });
    return false;
  }
}

/** Removes the audio, keeping the transcript, flags, and notes, after asking. Answers whether anything changed. */
export async function removeStoredAudio(stored: StoredRecording): Promise<boolean> {
  const old = liveEntry(stored);
  const block = blockOf(stored);
  if (block === null) return false;
  const ok = await confirm({
    title: t('audioMore.storage.removeTitle'),
    body: t('audioMore.storage.removeBody', { size: bytesText(stored.bytes) }),
    confirmLabel: t('audioMore.storage.removeAction'),
    cancelLabel: t('audioMore.storage.cancel'),
    danger: true,
  });
  if (!ok) return false;
  try {
    await closePlayback();
    const next = { ...withoutEnhanced(old), tracks: [], audioRemoved: true } as RecordingEntry;
    await writeEntry(stored.page, block, next, { drop: old });
    await saved(stored.page);
    await deleteAudioFiles(stored.assetsDir, old);
    const message = t('audioMore.storage.audioRemoved', { size: bytesText(stored.bytes) });
    announce(message);
    showToast({ message });
    return true;
  } catch (error) {
    showToast({ message: describeError(error), tone: 'danger' });
    return false;
  }
}

/** Whether the audio of this entry was removed to save space. */
export const wasRemoved = (entry: RecordingEntry): boolean => extrasOf(entry).audioRemoved === true;
