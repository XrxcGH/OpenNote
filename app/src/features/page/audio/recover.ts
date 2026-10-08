// Recovering recordings that a crash cut off (Phase 9). An entry that still says `recording` when its page opens, and
// isn't the recording that runs now, was cut off: the files have what was written, and the media crate rebuilds the
// entry from them (crates/media/src/service/README.md). The block is saved before any file exists, so an entry with
// no files means the app stopped between the two steps, and it goes with its block.
//
// "The recording that runs now" is the host's answer, not this window's: a page open in a second window while the
// first records it sees the live entry too, and the host refuses it with `audioRunning`, as it does once that window
// stopped it and is writing the final entry. That entry is left alone, and its block says another window has it.
// Only a recording none of whose files are there (`audioMissing`) is given up on. A file that is there but damaged
// (`audioCorrupt`) keeps its entry in `recording`, and its block says so: the file stays on disk, and calling it
// missing would hide it. Any other failure leaves the entry saying `recording` too, so the next open tries again
// instead of losing the files for good, and says so. A recording that never began recorded nothing, so with no
// usable files it goes with its block either way.
import type { RecordingEntry } from '../../../core/audio';
import type { OpenPage } from '../../../services/pages/types';
import { commandContext } from '../../../commands/registry';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { shownLayer } from '../mount';
import { activeNs, recordingBlocks, removeBlock, writeEntry } from './blocks';
import { platformAudio, runningRecording } from './controller';
import { entriesOf, holdRecovery } from './entries';
import { recordingIdOf } from './entry';
import { clock } from './format';

/** The host's refusal of the recording it is running now, in this window or another. */
const RUNNING = 'audioRunning';
/** The host's answer for a recording none of whose audio files are there. */
const GONE = 'audioMissing';
/** The host's answer for a recording whose files are there but can't be read. */
const DAMAGED = 'audioCorrupt';

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
      holdRecovery(entry.id, null);
      await writeEntry(page.id, block, finished.entry, { track: 'finished' });
      const time = clock(activeNs(finished.entry) / 1e6);
      announce(t('audio.announce.recovered', { time }));
      showToast({ message: t('audio.announce.recovered', { time }) });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === RUNNING) {
        holdRecovery(entry.id, 'elsewhere');
        continue;
      }
      if (code === DAMAGED && entry.clock !== undefined) {
        commandContext('commandBar').platform.log('warn', `Recording ${entry.id} is damaged: ${String(error)}`);
        holdRecovery(entry.id, 'damaged');
        showToast({ message: t('audio.block.damaged'), tone: 'danger' });
        continue;
      }
      if (code !== GONE && code !== DAMAGED) {
        commandContext('commandBar').platform.log('warn', `Recording ${entry.id} couldn't be recovered now: ${code}`);
        holdRecovery(entry.id, 'failed');
        showToast({ message: t('audio.block.notRecovered'), tone: 'danger' });
        continue;
      }
      holdRecovery(entry.id, null);
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
