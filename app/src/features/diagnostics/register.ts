// Registers Phase 13's commands, Settings sections, and title bar notices (docs/HARDENING.md). Everything heavy
// loads on first use, so this file stays small: the screens are in the sections and dialogs, loaded when shown.

import { defineCommand } from '../../commands/registry';
import { commands, settingsSections, titleBarItems } from '../../registries';
import { announce } from '../../ui';
import { t } from '../../strings/t';
import { openHelp, openPrivacy, showFeedback } from './openers';
import { changePrivacy, diagnostics, isOffline } from './runtime';
import { OfflineChip, SafeModeChip } from './Chips';

commands.register(
  defineCommand({
    id: 'diagnostics.help',
    title: 'diagnostics.commands.help',
    keywords: 'diagnostics.commands.helpKeywords',
    category: 'help',
    flag: 'diagnostics.selfCheck',
    run: openHelp,
  }),
);

commands.register(
  defineCommand({
    id: 'diagnostics.feedback',
    title: 'diagnostics.commands.feedback',
    keywords: 'diagnostics.commands.feedbackKeywords',
    category: 'help',
    flag: 'diagnostics.feedback',
    run: showFeedback,
  }),
);

commands.register(
  defineCommand({
    id: 'diagnostics.privacy',
    title: 'diagnostics.commands.privacy',
    keywords: 'diagnostics.commands.privacyKeywords',
    category: 'general',
    flag: 'privacy.panel',
    run: openPrivacy,
  }),
);

commands.register(
  defineCommand({
    id: 'diagnostics.workOffline',
    title: 'diagnostics.commands.workOffline',
    keywords: 'diagnostics.commands.workOfflineKeywords',
    category: 'general',
    flag: 'privacy.workOffline',
    checked: () => isOffline(),
    async run() {
      const next = !isOffline();
      await diagnostics().setWorkOffline(next);
      changePrivacy({ workOffline: next });
      announce(t(next ? 'diagnostics.privacy.announceOffline' : 'diagnostics.privacy.announceOnline'));
    },
  }),
);

settingsSections.register({
  id: 'privacy',
  title: 'diagnostics.privacy.section',
  icon: 'LockKey',
  order: 35,
  flag: 'privacy.panel',
  load: () => import('./PrivacySection'),
});

settingsSections.register({
  id: 'help',
  title: 'diagnostics.help.section',
  icon: 'Question',
  order: 40,
  flag: 'diagnostics.selfCheck',
  load: () => import('./HelpSection'),
});

titleBarItems.register({
  id: 'diagnostics.offline',
  side: 'end',
  order: 80,
  priority: 95,
  compact: 'appBar',
  Component: OfflineChip,
});

titleBarItems.register({
  id: 'diagnostics.safeMode',
  side: 'end',
  order: 81,
  priority: 96,
  compact: 'appBar',
  Component: SafeModeChip,
});
