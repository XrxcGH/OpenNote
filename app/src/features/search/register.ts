// Search and linking registrations (Phase 8): the commands, their keys, the palette, and quick switcher providers,
// and the link layer for the editors. This file loads at start-up, so it holds definitions only. The panel, the
// pane, the tags dialog, and the editor code load when first used.
import { chord, defineCommand } from '../../commands/registry';
import { commands, paletteProviders, titleBarItems } from '../../registries';
import { addSwitcherProvider } from '../palette';
import { showToast } from '../../ui';
import { t } from '../../strings/t';
import { maybeSearchClient } from './client';
import { editorHasFocus, runPageLinkCommand } from './links/events';
import { fuzzyTitles, textMatches } from './provider';
import { SearchButton } from './SearchButton';
import './registerQol';

commands.register(
  defineCommand({
    id: 'search.open',
    title: 'search.commands.open',
    keywords: 'search.commands.keywords.open',
    category: 'navigation',
    keys: [chord('Ctrl+Shift+F')],
    allowInTextInput: true,
    allowInModal: true,
    flag: 'search.panel',
    run: () => import('./open').then((module) => module.openSearchPanel()),
  }),
);

commands.register(
  defineCommand({
    id: 'search.linkedPages',
    title: 'search.commands.linkedPages',
    keywords: 'search.commands.keywords.linkedPages',
    category: 'view',
    keys: [chord('Ctrl+Alt+G')],
    allowInTextInput: true,
    flag: 'search.backlinks',
    run: () => import('./backlinks/pane').then((module) => module.toggleLinkedPages()),
  }),
);

commands.register(
  defineCommand({
    id: 'search.manageTags',
    title: 'search.commands.manageTags',
    keywords: 'search.commands.keywords.manageTags',
    category: 'general',
    flag: 'search.tags',
    run: () => import('./tags/open').then((module) => module.openTags()),
  }),
);

commands.register(
  defineCommand({
    id: 'search.insertLink',
    title: 'search.commands.insertLink',
    keywords: 'search.commands.keywords.insertLink',
    category: 'insert',
    scope: 'editor',
    keys: [chord('Ctrl+Alt+K')],
    allowInTextInput: true,
    flag: 'search.links',
    when: editorHasFocus,
    run: () => void runPageLinkCommand('start'),
  }),
);

commands.register(
  defineCommand({
    id: 'search.followLink',
    title: 'search.commands.followLink',
    keywords: 'search.commands.keywords.followLink',
    category: 'navigation',
    scope: 'editor',
    keys: [chord('Ctrl+Alt+Enter')],
    allowInTextInput: true,
    flag: 'search.links',
    when: editorHasFocus,
    run: () => void runPageLinkCommand('follow'),
  }),
);

commands.register(
  defineCommand({
    id: 'search.previewLink',
    title: 'search.commands.previewLink',
    keywords: 'search.commands.keywords.previewLink',
    category: 'view',
    scope: 'editor',
    keys: [chord('Ctrl+Alt+P')],
    allowInTextInput: true,
    flag: 'search.links',
    when: editorHasFocus,
    run: () => void runPageLinkCommand('preview'),
  }),
);

commands.register(
  defineCommand({
    id: 'search.rebuild',
    title: 'search.commands.rebuild',
    keywords: 'search.commands.keywords.rebuild',
    category: 'general',
    flag: 'search.panel',
    run: async () => {
      await maybeSearchClient()?.rebuild();
      showToast({ message: t('search.index.rebuilding') });
    },
  }),
);

titleBarItems.register({
  id: 'search.open',
  side: 'end',
  order: 90,
  priority: 90,
  compact: 'appBar',
  Component: SearchButton,
});

paletteProviders.register(fuzzyTitles);
paletteProviders.register(textMatches);
addSwitcherProvider(fuzzyTitles);
addSwitcherProvider(textMatches);
