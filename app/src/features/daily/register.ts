// The daily note and its calendar: a Today button in the title bar, and commands in the palette.
import { defineCommand } from '../../commands/registry';
import { commands, titleBarItems } from '../../registries';
import { DailyButton } from './DailyButton';

commands.register(
  defineCommand({
    id: 'daily.open',
    title: 'qolSearch.commands.dailyOpen',
    keywords: 'qolSearch.commands.keywords.daily',
    category: 'navigation',
    flag: 'daily.notes',
    run: async () => {
      const [{ openNote }, { today }] = await Promise.all([import('./notes'), import('./dates')]);
      await openNote('day', today());
    },
  }),
);

commands.register(
  defineCommand({
    id: 'daily.calendar',
    title: 'qolSearch.commands.dailyCalendar',
    keywords: 'qolSearch.commands.keywords.daily',
    category: 'navigation',
    flag: 'daily.notes',
    run: () => import('./open').then((module) => module.openDailyCalendar()),
  }),
);

titleBarItems.register({
  id: 'daily.open',
  side: 'end',
  order: 85,
  priority: 80,
  compact: 'appBar',
  Component: DailyButton,
});
