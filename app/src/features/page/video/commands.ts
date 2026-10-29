// The Add captions to a video command: the video block with the caret, or the only video on the page.
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { shownLayer } from '../mount';
import { shownPool } from '../pool/shown';
import { setCaptions } from './insert';
import { VIDEO_TYPE } from './model';

export async function captionsForActive(): Promise<void> {
  const videos = (shownLayer.get()?.blocks() ?? []).filter((block) => block.type === VIDEO_TYPE);
  const active = shownPool.get()?.active()?.block;
  const target = videos.find((block) => block.id === active) ?? (videos.length === 1 ? videos[0] : undefined);
  if (!target) return void showToast({ message: t('video.insert.nothing') });
  await setCaptions(target.id);
}
