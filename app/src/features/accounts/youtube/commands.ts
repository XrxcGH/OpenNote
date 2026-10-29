// Upload to YouTube: choose private or unlisted, name the video, and send it. The page's video is made by the caller (the
// recording is the page lane's), into the transfer folder, and removed afterwards whatever happens. Nothing goes to
// YouTube until the person presses the last button, and nothing is ever made public from here.
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { connectors } from '../../connectors';
import { accountsHost } from '../host';
import { attempt, isConnected, tellNotConnected } from '../run';
import { askText, pickOne } from '../ui/prompts';
import { uploadVideo } from './upload';
import type { YoutubePrivacy } from './upload';

export interface UploadRequest {
  /** A title to start from. */
  title: string;
  /** Makes the video under this name in the transfer folder and answers its size. */
  makeVideo(name: string): Promise<number>;
}

export async function uploadRecording(request: UploadRequest): Promise<void> {
  if (!(await isConnected('google'))) return tellNotConnected('YouTube');
  const privacy = await pickOne<YoutubePrivacy>({
    title: t('accounts.youtube.privacy.title'),
    description: t('accounts.youtube.privacy.description'),
    confirmLabel: t('accounts.youtube.privacy.confirm'),
    choices: [
      {
        id: 'private',
        label: t('accounts.youtube.privacy.private'),
        detail: t('accounts.youtube.privacy.privateDetail'),
        value: 'private',
      },
      {
        id: 'unlisted',
        label: t('accounts.youtube.privacy.unlisted'),
        detail: t('accounts.youtube.privacy.unlistedDetail'),
        value: 'unlisted',
      },
    ],
  });
  if (!privacy) return;
  const title = await askText({
    title: t('accounts.youtube.name.title'),
    description: t('accounts.youtube.name.description'),
    label: t('accounts.youtube.name.label'),
    initial: request.title,
    confirmLabel: t('accounts.youtube.name.confirm'),
  });
  if (!title) return;
  const host = accountsHost();
  const file = `youtube-${Date.now()}.mp4`;
  await attempt('YouTube', async () => {
    try {
      announce(t('accounts.youtube.making'));
      const size = await request.makeVideo(file);
      showToast({ id: 'youtube-upload', message: t('accounts.youtube.sending') });
      const done = await uploadVideo({ client: connectors(), host }, { file, size, title, privacy }, (share) =>
        announce(t('accounts.youtube.progress', { percent: Math.round(share * 100) })),
      );
      const message = t(privacy === 'private' ? 'accounts.youtube.donePrivate' : 'accounts.youtube.doneUnlisted');
      showToast({ id: 'youtube-upload', message });
      announce(message);
      try {
        await navigator.clipboard.writeText(done.url);
      } catch {
        // The link is in YouTube Studio either way.
      }
    } finally {
      await host.tempRemove(file).catch(() => undefined);
    }
  });
}
