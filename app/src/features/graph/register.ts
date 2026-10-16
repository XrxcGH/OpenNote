// The graph view and its Connections list open from the palette and from Ctrl+Alt+Shift+G.
import { chord, defineCommand } from '../../commands/registry';
import { commands } from '../../registries';

commands.register(
  defineCommand({
    id: 'graph.open',
    title: 'qolSearch.commands.graph',
    keywords: 'qolSearch.commands.keywords.graph',
    category: 'view',
    keys: [chord('Ctrl+Alt+Shift+G')],
    flag: 'graph.view',
    run: () => import('./open').then((module) => module.openGraph()),
  }),
);
