// Trimming a finished recording (Phase 9). An edit writes a new recording under new asset names and leaves the old
// files alone; the new entry takes the old one's place in the block, the page is saved, and only then do the old
// files go (crates/media/src/edit/README.md). Flags and text marks name the recording by its ID, which the edit
// keeps, so they still find their audio.
import { enhancedTracks, Flags, withoutEnhanced } from '../../../core/audio';
import type { RecordingEntry, SplitHalf } from '../../../core/audio';
import type { Edit } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce, confirm, showToast } from '../../../ui';
import { shownPage as shownOpenPage } from '../history/shown';
import { shownLayer } from '../mount';
import { shownQueue } from '../sync/shown';
import { insertRecordingBlock, writeEntry } from './blocks';
import { describeError, platformAudio } from './controller';
import { clockNs } from './format';
import { moreClient } from './moreClient';
import { closePlayback } from './playback';
import { marksOf } from './stamps';

/** The start of a part to remove, in nanoseconds into the audio, by recording. */
const partStarts = new Map<string, number>();
export const partStart = (recording: string) => partStarts.get(recording);
export function markPartStart(recording: string, positionNs: number): void {
  partStarts.set(recording, positionNs);
  announce(t('audio.block.removeStart', { time: clockNs(positionNs) }));
}

/** Deletes the files of an entry the page no longer lists, and of its enhanced copy. */
export async function deleteAudioFiles(dir: string, old: RecordingEntry): Promise<void> {
  const audio = platformAudio();
  await audio.deleteFiles(dir, old).catch(() => undefined);
  const copy = enhancedTracks(old);
  if (copy.length > 0) await audio.deleteFiles(dir, { ...old, tracks: copy }).catch(() => undefined);
}

/**
 * Saves the edited entry in the old one's place. An enhanced copy is of the audio as it was, so it goes: the person
 * enhances the new audio again. That is also what keeps a removed part out of the copy.
 */
async function replace(block: string, pageId: string, old: RecordingEntry, next: RecordingEntry): Promise<void> {
  const dir = await platformAudio().assetsDir(pageId);
  await writeEntry(pageId, block, withoutEnhanced(next), { track: 'finished', drop: old });
  await shownOpenPage.get()?.saveNow();
  await deleteAudioFiles(dir, old);
}

/** Gives the marks of the text that was written in the second half to the second recording. */
async function moveMarks(from: string, halves: readonly SplitHalf[]): Promise<void> {
  const edits: Edit[] = [];
  for (const block of shownLayer.get()?.blocks() ?? []) {
    const marks = marksOf(block.id);
    if (marks?.moveToSplit(from, halves))
      edits.push({ edit: 'patchBlock', block: block.id, data: { marks: marks.toData() } });
  }
  if (edits.length > 0) await shownQueue.get()?.send({ edits });
}

/**
 * Splits the recording at `positionNs`. The first half stays in its block with the recording's ID, and the second
 * is a new recording in a new block after it. Flags and the marks of typed text go to the half they were made in.
 */
export async function splitRecording(
  block: string,
  pageId: string,
  entry: RecordingEntry,
  positionNs: number,
): Promise<void> {
  try {
    const dir = await platformAudio().assetsDir(pageId);
    const more = await moreClient();
    await closePlayback();
    const { first, second } = await more.split(dir, entry, positionNs);
    const flags = Flags.fromEntries([entry]);
    flags.moveToSplit(entry.id, [first.entry, second.entry]);
    const [one, two] = [first.entry, second.entry].map((half) => flags.into(withoutEnhanced(half)));
    await writeEntry(pageId, block, one, { track: 'finished', drop: entry });
    await insertRecordingBlock(two, { after: block, track: 'finished' });
    await moveMarks(entry.id, [first.entry, second.entry]);
    await shownOpenPage.get()?.saveNow();
    await deleteAudioFiles(dir, entry);
    announce(t('audioMore.split.done', { first: clockNs(first.durationNs), second: clockNs(second.durationNs) }));
  } catch (error) {
    showToast({ message: describeError(error), tone: 'danger' });
  }
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
    body: `${t('audio.block.removeBody', { from: clockNs(startNs), to: clockNs(endNs) })} ${t('audioMore.remove.alsoPurges')}`,
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
    // The removed words go from the transcript, and the page's saved versions, which could bring the part back, go.
    await purgeRemoved(pageId);
    announce(t('audio.announce.trimmed', { time: clockNs(edited.durationNs) }));
  } catch (error) {
    showToast({ message: describeError(error), tone: 'danger' });
  }
}

/** Everything besides the audio that a removed part must leave. The page's saved versions could bring it back. */
async function purgeRemoved(pageId: string): Promise<void> {
  await (await moreClient()).purgeHistory(pageId).catch(() => undefined);
}
