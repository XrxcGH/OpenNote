// Export as video: the page as a picture, the ink drawn again at the moments it was drawn, and the recording's sound,
// saved as an MP4 file (H.264 and AAC, which Windows encodes itself). The host draws the frames; this builds the scene
// from the shown page. A stroke carries the time it was drawn in Unix milliseconds, and the recording's clock turns that
// into the recording's own time.
import { commandContext } from '../../../commands/registry';
import { captureOf, playable, unixOf } from '../../../core/audio';
import type { RecordingEntry, VideoScene } from '../../../core/audio';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { rasterShownPage } from '../../pages';
import type { PageRaster } from '../../pages';
import { shownStrokes } from '../seams/inkStrokes';
import { describeError, platformAudio } from './controller';
import { bytesText } from './format';
import { moreClient } from './moreClient';

const WORKING = 'audio-export-video';

/** The scene for a recording from the page's picture and strokes. Strokes outside the recording are left out. */
export function sceneFor(entry: RecordingEntry, raster: PageRaster): VideoScene {
  const clock = entry.clock;
  const strokes: VideoScene['strokes'] = [];
  if (clock) {
    const first = unixOf(clock, entry.startedNs);
    const last = unixOf(clock, entry.endedNs);
    const looks = new Map(raster.strokes.map((one) => [one.id, one]));
    for (const stroke of shownStrokes([...looks.keys()])) {
      const look = looks.get(stroke.id);
      if (!look) continue;
      const points = stroke.points
        .map((point, at) => ({
          x: (point.x - raster.origin.x) * raster.scale,
          y: (point.y - raster.origin.y) * raster.scale,
          unix: stroke.startTime + (point.time ?? at * 8),
        }))
        .filter((point) => point.unix >= first && point.unix <= last)
        .map((point) => ({ x: point.x, y: point.y, tNs: captureOf(clock, point.unix) }));
      if (points.length > 0) {
        strokes.push({ color: look.color, width: Math.max(1.5, look.width * raster.scale), points });
      }
    }
  }
  return { width: raster.width, height: raster.height, rgba: raster.rgba, strokes };
}

/** Makes the video in the accounts transfer folder under `name`, for an upload. Answers its size. */
export async function videoForUpload(pageId: string, entry: RecordingEntry, name: string): Promise<number> {
  const raster = await rasterShownPage(commandContext('commandBar'));
  if (!raster) throw new Error(t('audioMore.export.videoNoPage'));
  const dir = await platformAudio().assetsDir(pageId);
  return (await moreClient()).exportVideo(dir, playable(entry), { transfer: name }, sceneFor(entry, raster));
}

export async function exportVideo(pageId: string, entry: RecordingEntry): Promise<void> {
  try {
    const context = commandContext('commandBar');
    const dest = await context.platform.exports.pickSave({
      suggested: t('audioMore.export.name', { date: entry.started.slice(0, 10) }),
      label: t('audioMore.export.videoLabel'),
      extension: 'mp4',
    });
    if (!dest) return;
    showToast({ id: WORKING, message: t('audioMore.export.videoWorking') });
    const raster = await rasterShownPage(context);
    if (!raster) throw new Error(t('audioMore.export.videoNoPage'));
    const dir = await platformAudio().assetsDir(pageId);
    const size = await (await moreClient()).exportVideo(dir, playable(entry), { dest }, sceneFor(entry, raster));
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
