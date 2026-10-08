// Saving a recording as one audio file (Phase 9): WAV, which every program plays, or Opus, which is small. Windows'
// Save dialog picks the place, and the host mixes the tracks (the microphone and the PC's sound) into one. The audio
// is the enhanced copy when that is the one the person listens to.
import { commandContext } from '../../../commands/registry';
import { playable } from '../../../core/audio';
import type { ExportFormat, RecordingEntry } from '../../../core/audio';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { describeError, platformAudio } from './controller';
import { bytesText } from './format';
import { moreClient } from './moreClient';

const WORKING = 'audio-export';

export async function exportRecording(pageId: string, entry: RecordingEntry, format: ExportFormat): Promise<void> {
  try {
    const exports = commandContext('commandBar').platform.exports;
    const dest = await exports.pickSave({
      suggested: t('audioMore.export.name', { date: entry.started.slice(0, 10) }),
      label: t(format === 'wav' ? 'audioMore.export.wavLabel' : 'audioMore.export.opusLabel'),
      extension: format,
    });
    if (!dest) return;
    showToast({ id: WORKING, message: t('audioMore.export.working') });
    const dir = await platformAudio().assetsDir(pageId);
    const size = await (await moreClient()).exportAudio(dir, playable(entry), dest, format);
    const message = t('audioMore.export.done', { size: bytesText(size) });
    showToast({ id: WORKING, message });
    announce(message);
  } catch (error) {
    showToast({
      id: WORKING,
      message: t('audioMore.export.failed', { message: describeError(error) }),
      tone: 'danger',
    });
  }
}
