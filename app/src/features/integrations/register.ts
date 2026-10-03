// Registers the extra import, export, embed, and integration features of Phase 11 and later: the setup step, commands,
// and menu items. Each screen loads when it is used, so start-up carries only this file.

import { lazy } from 'react';
import { isEnabled } from '../../app/flags';
import { setupSteps } from '../../registries';
import { showOverlay } from '../../shell/commandbar/overlays';

const LazyImport = lazy(() => import('../interop/ImportDialog'));

/** How long after setup finishes the import window opens, so the notebook and its view are on screen first. */
const OPEN_IMPORT_AFTER_MS = 700;

setupSteps.register({
  id: 'import',
  title: 'moreInterop.setup.title',
  order: 40,
  scope: 'person',
  isEnabled: (ctx) => ctx.firstRun && isEnabled('setup.import'),
  load: () => import('./setup/ImportStep'),
  commit(ctx, draft) {
    if ((draft.import as { after?: boolean } | undefined)?.after) {
      setTimeout(
        () => showOverlay('interop-import', LazyImport, { interop: ctx.platform.interop, notes: ctx.notes }),
        OPEN_IMPORT_AFTER_MS,
      );
    }
    return Promise.resolve();
  },
});
