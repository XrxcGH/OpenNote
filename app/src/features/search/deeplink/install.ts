// Links that open OpenNote from outside: Outlook, Word, Teams, a browser, a shortcut. A second launch hands its
// arguments to the running window (single-instance), and the first launch's link waits in the shell until the
// window asks. Either way the link only opens a page.
import { isEnabled } from '../../../app/flags';
import type { Platform } from '../../../platform/types';
import type { NotesService } from '../../../services/notes/types';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { openAndReveal } from './jump';
import { linkInArgs, parseLink } from './url';
import type { OpenNoteLink } from './url';

/** Readers of the other opennote:// links, such as opennote://clip (features/integrations/clip). One returns true
 * when it took the link. */
export const otherLinkReaders = new Set<(url: string) => boolean>();

function readOther(url: string): void {
  for (const read of otherLinkReaders) if (read(url)) return;
}

export function installDeepLinks(platform: Platform, notes: NotesService): () => void {
  if (!isEnabled('search.paragraphLinks')) return () => undefined;
  const open = (link: OpenNoteLink) => {
    void openAndReveal(notes, link.page, link.target)
      .then((found) => {
        if (!found) {
          console.warn(`Link to page ${link.page}: the page is not in the notebook tree.`);
          showToast({ message: t('qolSearch.links.gone'), tone: 'danger' });
        }
      })
      .catch((error: unknown) => console.warn(`Link to page ${link.page} failed: ${String(error)}`));
  };
  // The shell also keeps a second launch's link until it is taken, because an event sent before the window finished
  // listening, or while it was busy, is lost. The link is taken on the event and again whenever the window gains focus
  // (a second launch focuses it), and the same link is never opened twice within a few seconds.
  let recent: { key: string; at: number } | null = null;
  const openOnce = (link: OpenNoteLink) => {
    const key = `${link.page}/${link.target ?? ''}`;
    if (recent && recent.key === key && Date.now() - recent.at < 4000) return;
    recent = { key, at: Date.now() };
    open(link);
  };
  const takePending = () =>
    void platform.search.extras
      ?.launchLink()
      .then((url) => {
        const link = url ? parseLink(url) : null;
        if (link) openOnce(link);
        else if (url) readOther(url);
      })
      .catch(() => undefined);
  // Subscribed before anything else runs, so a second launch's arguments are never heard late.
  const stopArgs = platform.window.onForwardedArgs((args) => {
    const link = linkInArgs(args);
    console.debug(`Forwarded launch with ${args.length} argument(s): ${link ? 'a link' : 'no link'}.`);
    if (link) openOnce(link);
    else args.forEach(readOther);
    takePending();
  });
  const onFocus = () => takePending();
  const view = typeof window === 'undefined' ? null : window;
  view?.addEventListener('focus', onFocus);
  takePending();
  return () => {
    stopArgs();
    view?.removeEventListener('focus', onFocus);
  };
}
