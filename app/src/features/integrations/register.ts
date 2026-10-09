// Registers the extra import, export, embed, and integration features of Phase 11 and later: the setup step, commands,
// and menu items. Each screen loads when it is used, so start-up carries only this file.

import { isEnabled } from '../../app/flags';
import { commandContext, executeCommand } from '../../commands/registry';
import { settingsSections, setupSteps } from '../../registries';
import { t } from '../../strings/t';
import { showToast } from '../../ui';
import { shownMounted } from '../page';
import { createSnipWatcher } from './snip/watch';
import type { SnipWatcher } from './snip/watch';

/** How long after setup finishes the import window opens, so the notebook and its view are on screen first. */
const OPEN_IMPORT_AFTER_MS = 700;

setupSteps.register({
  id: 'import',
  title: 'moreInterop.setup.title',
  order: 40,
  scope: 'person',
  isEnabled: (ctx) => ctx.firstRun && isEnabled('setup.import'),
  load: () => import('./setup/ImportStep'),
  commit(_ctx, draft) {
    if ((draft.import as { after?: boolean } | undefined)?.after) {
      setTimeout(() => void executeCommand('interop.import', undefined, 'menu'), OPEN_IMPORT_AFTER_MS);
    }
    return Promise.resolve();
  },
});

// The Snipping Tool offer (flag interop.snip): when the window gets the focus back after a picture reached the
// clipboard, a toast offers to add it to the open page. Adding sends the picture through the page's own paste.
if (typeof window !== 'undefined') {
  let watcher: SnipWatcher | null = null;
  const current = (): SnipWatcher | null => {
    if (!isEnabled('interop.snip')) return null;
    try {
      const { clipboard } = commandContext('menu').platform;
      watcher ??= createSnipWatcher(
        {
          clipboard,
          canAdd: () => {
            const mounted = shownMounted.get();
            return mounted !== null && !mounted.page.readOnly;
          },
          offer: (add) =>
            showToast({
              message: t('moreInterop.snip.offer'),
              action: { label: t('moreInterop.snip.add'), run: add },
            }),
        },
        () => void addScreenshotToPage(),
      );
      return watcher;
    } catch {
      return null;
    }
  };
  window.addEventListener('blur', () => void current()?.blurred());
  window.addEventListener('focus', () => void current()?.focused());
}

/** Reads the picture on the clipboard and pastes it into the open page as a file, the way a paste of a picture file goes. */
async function addScreenshotToPage(): Promise<void> {
  const mounted = shownMounted.get();
  if (!mounted || mounted.page.readOnly) return;
  const content = await commandContext('menu').platform.clipboard.read();
  if (!content.imageBmp) return;
  const data = new DataTransfer();
  data.items.add(new File([content.imageBmp], 'Screenshot.bmp', { type: 'image/bmp' }));
  const target = mounted.pool.active()?.editor.view.dom ?? mounted.viewport.sizer;
  target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
}

// Settings, then App permissions (flag api.local), beside Privacy, and the questions the local API asks the person
// before an app connects or changes notes. The questions show wherever the person is, so they listen from the start.
settingsSections.register({
  id: 'appPermissions',
  title: 'platformApi.section',
  icon: 'PlugsConnected',
  order: 35.5,
  flag: 'api.local',
  load: () => import('./api/AppPermissionsSection'),
});

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // After start-up has read the flags (app/start.ts), which runs once every feature file has loaded.
  setTimeout(() => {
    if (!isEnabled('api.local')) return;
    void import('./api/approvals').then(({ startApprovals }) => startApprovals());
  }, 0);
}
