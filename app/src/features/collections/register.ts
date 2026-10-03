// Collections: one command in the palette opens them.
import { defineCommand } from '../../commands/registry';
import { commands } from '../../registries';

commands.register(
  defineCommand({
    id: 'collections.open',
    title: 'qolSearch.commands.collections',
    keywords: 'qolSearch.commands.keywords.collections',
    category: 'navigation',
    flag: 'collections.views',
    run: () => import('./open').then((module) => module.openCollections()),
  }),
);
