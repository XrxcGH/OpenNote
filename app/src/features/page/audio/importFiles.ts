// Audio and video files dropped on a page become recordings (Phase 9). The sound is decoded with the codecs Windows
// has and written into the page's own `assets` folder as a recording of one track, so the file plays with the same
// player, speed, flags and time-stamped notes as a recording the app made. A video keeps its sound only.
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { shownPage as shownOpenPage } from '../history/shown';
import { insertRecordingBlock } from './blocks';
import { describeError, platformAudio } from './controller';
import { clockNs } from './format';
import { hasHost, moreClient } from './moreClient';

let reminded = false;

async function addOne(page: string, file: File): Promise<void> {
  const progress = `audio-file-${file.name}`;
  showToast({ id: progress, message: t('audioMore.files.working', { name: file.name }) });
  try {
    const dir = await platformAudio().assetsDir(page);
    const made = await (await moreClient()).importFile(dir, file.name, await file.arrayBuffer());
    await insertRecordingBlock({ ...made.entry, importedFrom: file.name }, { track: 'finished' });
    await shownOpenPage.get()?.saveNow();
    const message = t('audioMore.files.done', { name: file.name, length: clockNs(made.durationNs) });
    showToast({ id: progress, message });
    announce(message);
  } catch (error) {
    const unreadable = (error as { code?: string } | null)?.code === 'audioFormat';
    const message = unreadable ? t('audioMore.files.failed', { name: file.name }) : describeError(error);
    showToast({ id: progress, message, tone: 'danger' });
  }
}

/** Adds each file as a recording on the shown page, one after the other. */
export async function importFiles(files: readonly File[]): Promise<void> {
  const page = shownOpenPage.get()?.id;
  if (!page) return;
  if (!hasHost()) return void showToast({ message: t('audioMore.files.needsApp') });
  for (const file of files) await addOne(page, file);
  if (!reminded) {
    reminded = true;
    showToast({ message: t('audioMore.files.rights') });
  }
}
