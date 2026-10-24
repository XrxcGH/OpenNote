// Snap the screen while recording (Phase 9). A shortcut captures the screen, the window behind OpenNote, or a region,
// and puts the picture on the page, stamped to the moment of the recording, so tapping the picture plays what was said
// while it was on the screen. Nothing is captured before the person presses the key, and a toast shows each capture.
// Text in the picture is found by search when text recognition (on-device intelligence) is on.
import type { SnapKind } from '../../../core/audio';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { insertImages } from '../images/insert';
import { shownMedia } from '../images/shown';
import { describeError, snapStamp, stampBlockNow } from './controller';
import { openDialog } from './dialog';
import { recordingEntries } from './entries';
import { clockNs } from './format';
import { moreClient } from './moreClient';
import { RegionDialog } from './RegionDialog';

/** The picture cut to a part the person chose, or null if they canceled. */
function chooseRegion(png: ArrayBuffer): Promise<ArrayBuffer | null> {
  let result: ArrayBuffer | null = null;
  return openDialog((close) => (
    <RegionDialog
      png={png}
      onDone={(chosen) => {
        result = chosen;
        close();
      }}
    />
  )).then(() => result);
}

export async function snap(kind: SnapKind | 'region'): Promise<void> {
  const stamp = snapStamp();
  const mounted = shownMedia.get();
  if (!stamp || !mounted) return void showToast({ message: t('audioMore.snap.needsRecording') });
  try {
    const picture = await (await moreClient()).snap(kind === 'region' ? 'screen' : kind);
    const png = kind === 'region' ? await chooseRegion(picture) : picture;
    if (!png) return;
    const entry = [...recordingEntries.get().values()].find((held) => held.state === 'recording');
    const time = clockNs(stamp.captureNs - (entry?.startedNs ?? stamp.captureNs));
    const blocks = await insertImages(mounted, [
      {
        kind: 'bytes',
        bytes: png,
        name: `Snap ${time}.png`,
        mime: 'image/png',
        alt: t('audioMore.snap.alt', { time }),
      },
    ]);
    if (blocks[0]) await stampBlockNow(blocks[0], stamp.captureNs);
    const message = t('audioMore.snap.done', { time });
    showToast({ message });
    announce(message);
  } catch (error) {
    showToast({ message: t('audioMore.snap.failed', { message: describeError(error) }), tone: 'danger' });
  }
}
