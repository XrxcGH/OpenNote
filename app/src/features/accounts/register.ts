// Registers the commands of the account features. This file loads at start-up, so it holds definitions only: each
// command's work, and the dialogs it opens, load on first use. A command is hidden while its flag is off, and it is
// always there when the flag is on: with the account not connected it says so and offers Settings.
import { isEnabled } from '../../app/flags';
import type { FlagId } from '../../app/flags';
import { commandContext, defineCommand } from '../../commands/registry';
import type { CommandCategory, CommandDef } from '../../commands/types';
import { commands } from '../../registries';
import type { NodeId } from '../../services/notes/types';
import type { MessageKey } from '../../strings/t';
import { shownMounted } from '../page';

interface Spec {
  id: string;
  title: MessageKey;
  keywords: MessageKey;
  flag: FlagId;
  category?: CommandCategory;
  /** The command needs a page on screen. */
  needsPage?: boolean;
  run(): Promise<void>;
}

const pageShown = () => shownMounted.get() !== null;

const SPECS: readonly Spec[] = [
  {
    id: 'meetings.new',
    title: 'accounts.meetings.commands.new',
    keywords: 'accounts.meetings.commands.keywords',
    flag: 'accounts.meetings',
    run: () => import('./meetings/commands').then((module) => module.newMeetingNote()),
  },
  {
    id: 'share.slack',
    title: 'accounts.share.commands.slack',
    keywords: 'accounts.share.commands.keywords',
    flag: 'accounts.share',
    needsPage: true,
    run: () => import('./share/commands').then((module) => module.shareSlack()),
  },
  {
    id: 'share.teams',
    title: 'accounts.share.commands.teams',
    keywords: 'accounts.share.commands.keywords',
    flag: 'accounts.share',
    needsPage: true,
    run: () => import('./share/commands').then((module) => module.shareTeams()),
  },
  {
    id: 'lms.bring',
    title: 'accounts.lms.commands.bring',
    keywords: 'accounts.lms.commands.keywords',
    flag: 'accounts.lms',
    run: () => import('./lms/commands').then((module) => module.bringAssignments()),
  },
  {
    id: 'lms.submit',
    title: 'accounts.lms.commands.submit',
    keywords: 'accounts.lms.commands.keywords',
    flag: 'accounts.lms',
    needsPage: true,
    run: () => import('./lms/commands').then((module) => module.submitPage()),
  },
  {
    id: 'sendto.drive',
    title: 'accounts.sendTo.commands.drive',
    keywords: 'accounts.sendTo.commands.keywords',
    flag: 'accounts.sendTo',
    needsPage: true,
    run: () => import('./sendto/commands').then((module) => module.sendTo('drive')),
  },
  {
    id: 'sendto.onedrive',
    title: 'accounts.sendTo.commands.onedrive',
    keywords: 'accounts.sendTo.commands.keywords',
    flag: 'accounts.sendTo',
    needsPage: true,
    run: () => import('./sendto/commands').then((module) => module.sendTo('onedrive')),
  },
  {
    id: 'sendto.update',
    title: 'accounts.sendTo.commands.update',
    keywords: 'accounts.sendTo.commands.keywords',
    flag: 'accounts.sendTo',
    needsPage: true,
    run: () => import('./sendto/commands').then((module) => module.updateHere()),
  },
  {
    id: 'readwise.sync',
    title: 'accounts.readwise.commands.sync',
    keywords: 'accounts.readwise.commands.keywords',
    flag: 'accounts.readwise',
    category: 'general',
    run: () => import('./readwise/commands').then((module) => module.sync()),
  },
];

for (const spec of SPECS) {
  const def: CommandDef = {
    id: spec.id as CommandDef['id'],
    title: spec.title,
    category: spec.category ?? 'insert',
    keywords: spec.keywords,
    flag: spec.flag,
    ...(spec.needsPage ? { when: pageShown } : {}),
    run: spec.run,
  };
  commands.register(defineCommand(def));
}

// A page that was sent and has changed since offers to update its copy when it is opened. The check reads one small
// file and costs nothing until a page is shown.
shownMounted.subscribe(() => {
  const mounted = shownMounted.get();
  if (!mounted || !isEnabled('accounts.sendTo')) return;
  const page = mounted.page.id;
  void import('./sendto/commands').then(async (module) => {
    const node = await commandContext('palette').notes.get(page as NodeId);
    if (node) await module.offerUpdate(page, node.modified);
  });
});
