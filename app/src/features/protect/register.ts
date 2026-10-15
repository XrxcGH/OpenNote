// The storage and protection features' start-up (beta 5). features/index.ts loads every register.ts.
// It listens for the shell's storage events in every window: pages that must open again after their notebook's
// folder was renamed or moved, and a folder that kept its name. After a crash, the next start points once, calmly,
// to Check notebook for the notebook that is open (A2-2).

import { isEnabled } from '../../app/flags';
import { getLocation } from '../../app/location';
import { commandContext } from '../../commands/registry';
import type { NodeId } from '../../services/notes';
import { shellHost } from '../../platform/shellqol';
import { t } from '../../strings/t';
import { showToast } from '../../ui';
import { loadExternalNotice } from '../qol';

if (typeof window !== 'undefined') {
  shellHost().listen((event) => {
    if (event.kind === 'reopenPages' && Array.isArray(event.pages)) {
      const location = getLocation();
      if (location.view === 'workspace' && location.pageId && event.pages.includes(location.pageId)) {
        const page = location.pageId;
        void loadExternalNotice().then((loaded) => loaded.reloadPage(page));
      }
    } else if (event.kind === 'folderRenameFailed') {
      showToast({ message: t('storage.folders.renameFailed') });
    }
  });
}

/** How long after start the pointer waits, so it never competes with the first paint or the safe start offer. */
const POINTER_DELAY_MS = 4000;

/**
 * Shows the note that points to Check notebook when the last session crashed and a notebook is open. Returns
 * whether it showed.
 */
export function pointToCheck(previous: string, notebookId: NodeId | null): boolean {
  if (previous !== 'crashed' || !notebookId || !isEnabled('qol.checkNotebook')) return false;
  showToast({
    id: 'check-after-crash',
    message: t('storage.check.afterCrash'),
    action: {
      label: t('storage.check.afterCrashAction'),
      run: async () => {
        const book = await commandContext('menu').notes.get(notebookId);
        if (book) await (await import('../qol/CheckNotebook')).openNotebookCheck(book);
      },
    },
  });
  return true;
}

if (typeof window !== 'undefined') {
  setTimeout(() => {
    try {
      const location = getLocation();
      const notebook = location.view === 'workspace' ? location.notebookId : null;
      void commandContext('menu')
        .platform.diagnostics.startup()
        .then((startup) => pointToCheck(startup.report.previous, notebook))
        .catch(() => {});
    } catch {
      // The commands aren't configured in this window, so there is nothing to point to.
    }
  }, POINTER_DELAY_MS);
}
