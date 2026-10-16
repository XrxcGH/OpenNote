// Registers the extra import, export, embed, and integration features of Phase 11 and later: the setup step, commands,
// and menu items. Each screen loads when it is used, so start-up carries only this file.

import { isEnabled } from '../../app/flags';
import { commandContext, defineCommand } from '../../commands/registry';
import type { CommandDef } from '../../commands/types';
import { commandBar, commands, settingsSections, setupSteps } from '../../registries';
import { t } from '../../strings/t';
import { showToast } from '../../ui';
import { shownMounted } from '../page';
import { RUN_AFTER_SETUP, afterSetupCommands } from '../setup';
import { openPage, otherLinkReaders } from '../search';
import { offerClip } from './clip/link';
import { createSnipWatcher } from './snip/watch';
import type { SnipWatcher } from './snip/watch';

setupSteps.register({
  id: 'import',
  title: 'moreInterop.setup.title',
  order: 40,
  scope: 'person',
  isEnabled: (ctx) => ctx.firstRun && isEnabled('setup.import'),
  load: () => import('./setup/ImportStep'),
  commit(_ctx, draft) {
    // Finishing setup opens the import window, or the next start does when setup moves the app (setup/runtime.ts).
    if ((draft.import as { after?: boolean } | undefined)?.after) {
      draft[RUN_AFTER_SETUP] = [...afterSetupCommands(draft), 'interop.import'];
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

// Insert > From phone (flag integrations.phoneScan): a QR code a phone scans to send photos onto the open page.
commands.register({
  id: 'insert.fromPhone',
  title: 'platformApi.phone.command',
  keywords: 'platformApi.phone.keywords',
  category: 'insert',
  icon: 'DeviceMobileCamera',
  flag: 'integrations.phoneScan',
  when: () => {
    const mounted = shownMounted.get();
    return mounted !== null && !mounted.page.readOnly;
  },
  run: () => void import('./phone/open').then(({ openPhoneDialog }) => openPhoneDialog()),
});
commandBar.register({
  id: 'integrations.fromPhone',
  tab: 'insert',
  group: 'media',
  command: 'insert.fromPhone',
  priority: 20,
  flag: 'integrations.phoneScan',
});

// Setup's "Add the opennote command to PATH" (flag api.local): the folder the move puts the command in goes on the
// user's PATH, or comes off again when the move fails. Not in the palette; Settings has its own switch.
commands.register(
  defineCommand<{ on: boolean }>({
    id: 'api.cliPathOnMove',
    title: 'platformApi.setupCliPath',
    category: 'general',
    palette: false,
    flag: 'api.local',
    run: (_ctx, args) =>
      import('./api/host').then(({ apiHost }) =>
        apiHost()
          .call('setCliPath', { on: args.on, afterMove: true })
          .then(() => undefined),
      ),
  }) as unknown as CommandDef,
);

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
    if (isEnabled('integrations.shareTarget')) {
      void import('./share/start').then(({ startShareReceiver }) => {
        try {
          startShareReceiver(commandContext('menu'));
        } catch {
          // Commands aren't configured, as in a component test.
        }
      });
    }
    if (!isEnabled('api.local')) return;
    void import('./api/approvals').then(({ startApprovals }) => startApprovals());
  }, 0);

  // The web clipper's fallback link (opennote://clip): an offer to add the page to Quick notes, never a page alone.
  otherLinkReaders.add((url) =>
    offerClip(url, {
      quickNote: (title, source) =>
        import('./share/start').then(({ quickNote }) => quickNote('clip', title, '', source)),
      open: (page) => void openPage(commandContext('menu').notes, page),
    }),
  );
}
