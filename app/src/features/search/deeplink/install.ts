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
  // Subscribed before anything else runs, so a second launch's arguments are never heard late.
  const stop = platform.window.onForwardedArgs((args) => {
    const link = linkInArgs(args);
    console.debug(`Forwarded launch with ${args.length} argument(s): ${link ? 'a link' : 'no link'}.`);
    if (link) open(link);
  });
  void platform.search.extras
    ?.launchLink()
    .then((url) => {
      const link = url ? parseLink(url) : null;
      if (link) open(link);
    })
    .catch(() => undefined);
  return stop;
}
