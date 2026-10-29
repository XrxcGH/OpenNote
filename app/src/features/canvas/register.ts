// The canvas of the open page opens from the palette.
import { defineCommand } from '../../commands/registry';
import { commands } from '../../registries';

commands.register(
  defineCommand({
    id: 'canvas.open',
    title: 'qolSearch.commands.canvas',
    keywords: 'qolSearch.commands.keywords.canvas',
    category: 'view',
    flag: 'canvas.cards',
    run: () => import('./open').then((module) => module.openCanvas()),
  }),
);
