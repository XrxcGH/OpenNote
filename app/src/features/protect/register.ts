// The storage and protection features' start-up (beta 5). features/index.ts loads every register.ts.
// It listens for the shell's storage events in every window: pages that must open again after their notebook's
// folder was renamed or moved, and a folder that kept its name.

import { getLocation } from '../../app/location';
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
