// Registers optional sync (ADR 0049, behind sync.e2ee): Settings > Sync, its commands, and the title bar notice.
// The page loads on first use; the notice reads the state once a minute after sync is set up.

import { navigate } from '../../app/location';
import { defineCommand } from '../../commands/registry';
import { commands, settingsSections, titleBarItems } from '../../registries';
import { t } from '../../strings/t';
import { announce, showToast } from '../../ui';
import { SyncChip, useSyncChipVisible } from './Chip';
import { codeOf, errorText, summaryLines } from './model';
import { passphraseAsked, refreshSync, setView, syncClient, syncStore } from './runtime';

const open = () => navigate({ view: 'settings', section: 'sync' });

async function ready(): Promise<boolean> {
  const view = syncStore.get() ?? (await refreshSync());
  if (view?.configured) return true;
  open();
  showToast({ message: t('sync.commands.notSetUp') });
  return false;
}

async function attempt(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    showToast({ message: errorText(codeOf(error)), tone: 'danger' });
  }
}

settingsSections.register({
  id: 'sync',
  title: 'sync.section',
  icon: 'ArrowsClockwise',
  order: 37,
  flag: 'sync.e2ee',
  load: () => import('./SyncSection'),
});

commands.register(
  defineCommand({
    id: 'sync.now',
    title: 'sync.commands.now',
    keywords: 'sync.commands.nowKeywords',
    category: 'general',
    flag: 'sync.e2ee',
    async run() {
      if (!(await ready())) return;
      await attempt(async () => {
        const result = await syncClient().syncNow();
        setView(result.view);
        showToast({ message: t('sync.done.synced') });
      });
    },
  }),
);

commands.register(
  defineCommand({
    id: 'sync.pause',
    title: 'sync.commands.pause',
    keywords: 'sync.commands.pauseKeywords',
    category: 'general',
    flag: 'sync.e2ee',
    checked: () => syncStore.get()?.status.state === 'paused',
    async run() {
      if (!(await ready())) return;
      const next = syncStore.get()?.status.state !== 'paused';
      await attempt(async () => {
        setView(await syncClient().setPaused(next));
        announce(t(next ? 'sync.done.paused' : 'sync.done.resumed'));
      });
    },
  }),
);

commands.register(
  defineCommand({
    id: 'sync.preview',
    title: 'sync.commands.preview',
    keywords: 'sync.commands.previewKeywords',
    category: 'general',
    flag: 'sync.e2ee',
    async run() {
      if (!(await ready())) return;
      await attempt(async () => {
        const { summary } = await syncClient().preview();
        showToast({ message: summaryLines(summary).join(' ') });
      });
    },
  }),
);

commands.register(
  defineCommand({
    id: 'sync.changePassphrase',
    title: 'sync.commands.changePassphrase',
    keywords: 'sync.commands.changePassphraseKeywords',
    category: 'general',
    flag: 'sync.e2ee',
    async run() {
      if (!(await ready())) return;
      passphraseAsked.set(true);
      open();
    },
  }),
);

commands.register(
  defineCommand({
    id: 'sync.open',
    title: 'sync.commands.open',
    keywords: 'sync.commands.openKeywords',
    category: 'general',
    flag: 'sync.e2ee',
    run: open,
  }),
);

titleBarItems.register({
  id: 'sync.status',
  side: 'end',
  order: 79,
  priority: 60,
  compact: 'appBar',
  Component: SyncChip,
  useVisible: useSyncChipVisible,
});
