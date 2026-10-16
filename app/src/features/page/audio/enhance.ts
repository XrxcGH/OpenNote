// Voice enhancement (Phase 9). "Enhance voice" makes a copy of the recording with the steady noise turned down and
// loud and quiet speech evened out. The original is never changed: the entry keeps the copy's tracks beside the
// original's, `listen` says which one plays, and `transcribeWith` which one the transcript is made from. Both share
// one timeline, so flags, notes and times need no change.
import { enhancedTracks, extrasOf, withoutEnhanced } from '../../../core/audio';
import type { RecordingEntry } from '../../../core/audio';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce, confirm, showToast } from '../../../ui';
import { shownPage as shownOpenPage } from '../history/shown';
import { writeEntry } from './blocks';
import { describeError, platformAudio } from './controller';
import { moreClient } from './moreClient';
import { reopenPlayback } from './playback';

const WORKING = 'audio-enhance';

/** Saves the entry with the copy, or with the choice of which audio to use. */
async function save(
  pageId: string,
  block: BlockJson,
  next: RecordingEntry,
  change?: Parameters<typeof writeEntry>[3],
): Promise<void> {
  await writeEntry(pageId, block.id, next, change);
  await shownOpenPage.get()?.saveNow();
}

/** Makes the enhanced copy, saves it with the recording, and switches playback to it. */
export async function enhanceVoice(block: BlockJson, pageId: string, entry: RecordingEntry): Promise<void> {
  showToast({ id: WORKING, message: t('audioMore.enhance.working') });
  try {
    const dir = await platformAudio().assetsDir(pageId);
    const copy = await (await moreClient()).enhance(dir, entry);
    const next = { ...entry, enhanced: { tracks: copy.entry.tracks }, listen: 'enhanced' } as RecordingEntry;
    await save(pageId, block, next, { enhanced: true });
    await reopenPlayback(block, pageId);
    showToast({ id: WORKING, message: t('audioMore.enhance.done') });
    announce(t('audioMore.enhance.done'));
  } catch (error) {
    showToast({ id: WORKING, message: describeError(error), tone: 'danger' });
  }
}

/** Chooses which audio plays, and whether the transcript uses it. */
export async function chooseAudio(
  block: BlockJson,
  pageId: string,
  entry: RecordingEntry,
  choice: { listen?: 'original' | 'enhanced'; transcribeWith?: 'original' | 'enhanced' },
): Promise<void> {
  if (enhancedTracks(entry).length === 0) return;
  await save(pageId, block, { ...entry, ...choice });
  if (choice.listen) await reopenPlayback(block, pageId);
}

/** Removes the enhanced copy, after asking. The original stays. */
export async function removeEnhanced(block: BlockJson, pageId: string, entry: RecordingEntry): Promise<void> {
  const copy = enhancedTracks(entry);
  if (copy.length === 0) return;
  const ok = await confirm({
    title: t('audioMore.enhance.removeTitle'),
    body: t('audioMore.enhance.removeBody'),
    confirmLabel: t('audioMore.enhance.removeAction'),
    cancelLabel: t('audioMore.enhance.cancel'),
    danger: true,
  });
  if (!ok) return;
  try {
    const audio = platformAudio();
    const dir = await audio.assetsDir(pageId);
    const wasListening = extrasOf(entry).listen === 'enhanced';
    await save(pageId, block, withoutEnhanced(entry), { drop: { ...entry, tracks: [] } });
    await audio.deleteFiles(dir, { ...entry, tracks: copy }).catch(() => undefined);
    if (wasListening) await reopenPlayback(block, pageId);
    announce(t('audioMore.enhance.removed'));
  } catch (error) {
    showToast({ message: describeError(error), tone: 'danger' });
  }
}
