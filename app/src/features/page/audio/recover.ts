// Recovering recordings that a crash cut off (Phase 9). An entry that still says `recording` when its page opens, and
// isn't the recording that runs now, was cut off: the files have what was written, and the media crate rebuilds the
// entry from them (crates/media/src/service/README.md). The block is saved before any file exists, so an entry with
// no files means the app stopped between the two steps, and it goes with its block.
//
// "The recording that runs now" is the host's answer, not this window's: a page open in a second window while the
// first records it sees the live entry too, and the host refuses it with `audioRunning`. That entry is left alone.
// Only a recording the host found nothing usable for (`audioCorrupt`) is given up on; any other failure leaves the
// entry saying `recording`, so the next open tries again instead of losing the files for good.
import type { RecordingEntry } from '../../../core/audio';
import type { OpenPage } from '../../../services/pages/types';
import { commandContext } from '../../../commands/registry';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { shownLayer } from '../mount';
import { activeNs, recordingBlocks, removeBlock, writeEntry } from './blocks';
import { platformAudio, runningRecording } from './controller';
import { entriesOf } from './entries';
import { recordingIdOf } from './entry';
import { clock } from './format';

/** The host's refusal of the recording it is running now, in this window or another. */
const RUNNING = 'audioRunning';
/** The host's answer for a recording with no usable files. */
const GONE = 'audioCorrupt';

/** The recordings being recovered now, so an undo that comes while one is recovered doesn't start it twice. */
const inFlight = new Set<string>();

async function blockFor(recording: string): Promise<string | null> {
  for (let tries = 0; tries < 20; tries += 1) {
    const block = recordingBlocks().find((candidate) => recordingIdOf(candidate) === recording);
    if (block && shownLayer.get()?.block(block.id)) return block.id;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/** Recovers the entries of `page` that say `recording` and don't belong to the recording that runs now. */
export async function recoverEntries(page: OpenPage, entries: readonly RecordingEntry[]): Promise<void> {
  for (const entry of entries) {
    if (entry.state !== 'recording') continue;
    if (entry.id === runningRecording() || inFlight.has(entry.id)) continue;
    inFlight.add(entry.id);
    const block = await blockFor(entry.id);
    if (!block) {
      inFlight.delete(entry.id);
      continue;
    }
    const audio = platformAudio();
    try {
      const dir = await audio.assetsDir(page.id);
      const finished = await audio.host.recover(dir, entry);
      await writeEntry(page.id, block, finished.entry, { track: 'finished' });
      const time = clock(activeNs(finished.entry) / 1e6);
      announce(t('audio.announce.recovered', { time }));
      showToast({ message: t('audio.announce.recovered', { time }) });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === RUNNING) continue;
      if (code !== GONE) {
        commandContext('commandBar').platform.log('warn', `Recording ${entry.id} couldn't be recovered now: ${code}`);
        continue;
      }
      if (entry.clock === undefined) {
        await removeBlock(block, entry.id).catch(() => undefined);
      } else {
        await writeEntry(page.id, block, { ...entry, state: 'recovered' }).catch(() => undefined);
        showToast({ message: t('audio.block.missing'), tone: 'danger' });
      }
    } finally {
      inFlight.delete(entry.id);
    }
  }
}

export const recoverPage = (page: OpenPage) => recoverEntries(page, entriesOf(page.initial.view));
