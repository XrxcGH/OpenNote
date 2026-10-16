// Audio and video files dropped on a page (Phase 9). The page's own drop handler knows images, text, and links, so
// this one listens first, takes only the media files, and leaves every other drop to the page. It stays small
// because it loads at start-up: the work loads when a media file is dropped.
import { isEnabled } from '../../../app/flags';
import { shownPage as shownOpenPage } from '../history/shown';

const EXTENSIONS = /\.(mp3|m4a|aac|wav|wma|flac|ogg|oga|opus|mp4|m4v|mov|wmv|webm|mkv|avi)$/i;

/** Whether a file is something to listen to: its type says so, or its name does when the type is unknown. */
export const isMediaFile = (file: Pick<File, 'name' | 'type'>): boolean =>
  file.type.startsWith('audio/') || file.type.startsWith('video/') || EXTENSIONS.test(file.name);

/** Whether the drag carries files that are audio or video, as far as a drag in progress says. */
function carriesMedia(data: DataTransfer | null): boolean {
  return [...(data?.items ?? [])].some(
    (item) => item.kind === 'file' && (item.type.startsWith('audio/') || item.type.startsWith('video/')),
  );
}

const inPage = (target: EventTarget | null): boolean =>
  target instanceof Element && !target.closest('dialog, input, textarea, select, [role="dialog"]');

/** Starts listening. Answers a function that stops. */
export function installDropWatch(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const over = (event: DragEvent) => {
    if (!isEnabled('audio.import') || !shownOpenPage.get() || !carriesMedia(event.dataTransfer)) return;
    if (!inPage(event.target)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };
  const drop = (event: DragEvent) => {
    if (!isEnabled('audio.import') || !shownOpenPage.get() || !inPage(event.target)) return;
    const media = [...(event.dataTransfer?.files ?? [])].filter(isMediaFile);
    if (media.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void import('./importFiles').then((module) => module.importFiles(media));
  };
  document.addEventListener('dragover', over, true);
  document.addEventListener('drop', drop, true);
  return () => {
    document.removeEventListener('dragover', over, true);
    document.removeEventListener('drop', drop, true);
  };
}
