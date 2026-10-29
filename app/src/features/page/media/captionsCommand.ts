// The Add captions as a transcript command: choose a YouTube or Vimeo video on the page, read its captions through the
// connected account, and keep them on the video's block, where each line jumps the player to its moment.
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { isConnected, pickOne, tellNotConnected, failureText } from '../../accounts';
import { shownLayer } from '../mount';
import { shownQueue } from '../sync/shown';
import { CaptionsError, fetchTranscript } from './captionsFetch';
import { embedDataOf, EMBED_TYPE } from './model';
import { PROVIDER_NAME } from './recognize';

interface Video {
  block: string;
  provider: 'youtube' | 'vimeo';
  id: string;
  title: string;
}

/** The YouTube and Vimeo videos on the shown page. */
export function videosOnPage(): Video[] {
  const found: Video[] = [];
  for (const block of shownLayer.get()?.blocks() ?? []) {
    if (block.type !== EMBED_TYPE) continue;
    const data = embedDataOf(block);
    if (data && (data.provider === 'youtube' || data.provider === 'vimeo')) {
      found.push({ block: block.id, provider: data.provider, id: data.id, title: data.title });
    }
  }
  return found;
}

export async function addCaptions(): Promise<void> {
  const queue = shownQueue.get();
  const videos = videosOnPage();
  if (!queue || videos.length === 0) return void showToast({ message: t('accounts.media.captions.noVideos') });
  const video =
    videos.length === 1
      ? videos[0]
      : await pickOne<Video>({
          title: t('accounts.media.captions.pick'),
          description: t('accounts.media.captions.pickDescription'),
          confirmLabel: t('accounts.media.captions.pickConfirm'),
          choices: videos.map((one) => ({
            id: one.block,
            label: one.title,
            detail: PROVIDER_NAME[one.provider],
            value: one,
          })),
        });
  if (!video) return;
  const service = video.provider === 'youtube' ? 'YouTube' : 'Vimeo';
  if (!(await isConnected(video.provider === 'youtube' ? 'google' : 'vimeo'))) return tellNotConnected(service);
  announce(t('accounts.media.captions.working'));
  try {
    const transcript = await fetchTranscript(
      undefined,
      video.provider,
      video.id,
      typeof navigator === 'undefined' ? 'en' : navigator.language,
    );
    if (!shownLayer.get()?.block(video.block)) return;
    await queue.send({ edits: [{ edit: 'patchBlock', block: video.block, data: { transcript } }] });
    const message = t('accounts.media.captions.done', { count: transcript.lines.length, title: video.title });
    showToast({ message });
    announce(message);
  } catch (error) {
    if (error instanceof CaptionsError) {
      showToast({
        message: t(error.reason === 'none' ? 'accounts.media.captions.none' : 'accounts.media.captions.notOwner'),
      });
      return;
    }
    showToast({ message: failureText(error, service) });
  }
}
