// Registers the updates feature (ARCHITECTURE.md section 18.11). That's its commands, the chip before the theme
// toggle, and the Updates section of Settings. It also makes one polite announcement per ready version, and shows
// the toasts for the boot payload's update notices.

import { executeCommand } from '../../commands/registry';
import { settingsSections, titleBarItems } from '../../registries';
import { getSettings } from '../../state/settings';
import { updaterNoticesStore, updaterStore } from '../../state/updater';
import type { UpdaterNotice } from '../../state/updater';
import { t } from '../../strings/t';
import { announce, showToast } from '../../ui';
import type { ToastSpec } from '../../ui';
import { registerUpdateCommands } from './commands';
import { readyAnnouncement } from './model';
import { UpdateChip } from './UpdateChip';

registerUpdateCommands();

titleBarItems.register({
  id: 'updates.chip',
  side: 'end',
  order: 90,
  priority: 90,
  compact: 'bottomMore',
  Component: UpdateChip,
});

settingsSections.register({
  id: 'updates',
  title: 'updates.section.title',
  icon: 'ArrowsClockwise',
  order: 30,
  load: () => import('./UpdatesSection'),
});

const announced = new Set<string>();

updaterStore.subscribe(() => {
  const { phase } = updaterStore.get();
  if (phase.kind !== 'ready' || announced.has(phase.version)) return;
  announced.add(phase.version);
  announce(readyAnnouncement(getSettings().updates.install));
});

/** The toast for an update notice, with the way to act on it. */
export function noticeToast(notice: UpdaterNotice): ToastSpec {
  switch (notice.kind) {
    case 'updated':
      return {
        message: t('updates.notices.updated', { to: notice.to }),
        action: {
          label: t('updates.actions.whatsNew'),
          run: () => void executeCommand('updates.whatsNew', notice.to, 'menu'),
        },
      };
    case 'rolledBack':
      return {
        message: t('updates.notices.rolledBack', { from: notice.from, to: notice.to }),
        action: {
          label: t('updates.notices.report'),
          run: () => void executeCommand('updates.report', undefined, 'menu'),
        },
      };
    case 'rollbackUnavailable':
      return {
        message: t('updates.notices.rollbackUnavailable', { from: notice.from }),
        tone: 'danger',
        action: downloadPrevious(notice.previous),
      };
  }
}

/** The link to the previous version's download page, when its version is known. */
function downloadPrevious(version: string | null): ToastSpec['action'] {
  if (!version) return undefined;
  return {
    label: t('updates.notices.downloadPrevious', { version }),
    run: () => void executeCommand('updates.whatsNew', version, 'menu'),
  };
}

updaterNoticesStore.subscribe(() => {
  const notices = updaterNoticesStore.get();
  if (notices.length === 0) return;
  updaterNoticesStore.set([]);
  notices.forEach((notice) => showToast(noticeToast(notice)));
});
