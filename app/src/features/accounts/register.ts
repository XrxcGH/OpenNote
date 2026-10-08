// Registers the commands of the account features. This file loads at start-up, so it holds definitions only: each
// command's work, and the dialogs it opens, load on first use. A command is hidden while its flag is off, and it is
// always there when the flag is on: with the account not connected it says so and offers Settings.
import type { FlagId } from '../../app/flags';
import { defineCommand } from '../../commands/registry';
import type { CommandCategory, CommandDef } from '../../commands/types';
import { commands } from '../../registries';
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
