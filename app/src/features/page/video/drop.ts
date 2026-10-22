// Video files dropped or pasted on a page. Like the audio drop watch it listens first and takes only mp4 and webm
// files, leaving every other drop to the page. The work loads when a video file arrives.
import { isEnabled } from '../../../app/flags';
import { shownPage as shownOpenPage } from '../history/shown';
import { videoMimeOf } from './kinds';

const inPage = (target: EventTarget | null): boolean =>
  target instanceof Element && !target.closest('dialog, input, textarea, select, [role="dialog"]');

const videosIn = (files: Iterable<File> | undefined): File[] => [...(files ?? [])].filter((f) => videoMimeOf(f));

/** Whether a drag in progress carries a video file, as far as its items say. */
function carriesVideo(data: DataTransfer | null): boolean {
  return [...(data?.items ?? [])].some(
    (item) => item.kind === 'file' && (item.type === 'video/mp4' || item.type === 'video/webm'),
  );
}

/** Starts listening. Answers a function that stops. */
export function installVideoWatch(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const ready = () => isEnabled('page.localVideo') && shownOpenPage.get() !== null;
  const over = (event: DragEvent) => {
    if (!ready() || !carriesVideo(event.dataTransfer) || !inPage(event.target)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };
  const take = (event: Event, files: File[]) => {
    event.preventDefault();
    event.stopPropagation();
    void import('./insert').then((module) => module.insertVideoFiles(files));
  };
  const drop = (event: DragEvent) => {
    if (!ready() || !inPage(event.target)) return;
    const files = videosIn(event.dataTransfer?.files);
    if (files.length > 0) take(event, files);
  };
  const paste = (event: ClipboardEvent) => {
    if (!ready() || !inPage(event.target)) return;
    const files = videosIn(event.clipboardData?.files);
    if (files.length > 0) take(event, files);
  };
  document.addEventListener('dragover', over, true);
  document.addEventListener('drop', drop, true);
  document.addEventListener('paste', paste, true);
  return () => {
    document.removeEventListener('dragover', over, true);
    document.removeEventListener('drop', drop, true);
    document.removeEventListener('paste', paste, true);
  };
}
