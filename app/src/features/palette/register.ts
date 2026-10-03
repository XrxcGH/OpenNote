// Registers the command palette (Ctrl+K) and the quick switcher (Ctrl+O) with their providers: commands, and "Go to"
// results for notebooks, sections, and pages. Both Ctrl+K and Ctrl+O work in text fields, and in dialogs, where
// pressing either again closes it. The OneNote shortcut set adds Ctrl+E, OneNote's search key, to the switcher.

import { chord, defineCommand } from '../../commands/registry';
import { commands, paletteProviders } from '../../registries';
import { commandsProvider } from './commandsProvider';
import { nodesProvider } from './nodes';
import { preloadWhenIdle, togglePalette } from './open';
import { trackRecentPages } from './recent';

commands.register(
  defineCommand({
    id: 'app.palette',
    title: 'commands.app.palette',
    keywords: 'commands.keywords.palette',
    category: 'general',
    keys: [chord('Ctrl+K')],
    allowInTextInput: true,
    allowInModal: true,
    // Opening the palette from the palette would do nothing.
    palette: false,
    run: () => togglePalette('palette'),
  }),
);

commands.register(
  defineCommand({
    id: 'app.quickSwitcher',
    title: 'commands.app.quickSwitcher',
    keywords: 'commands.keywords.quickSwitcher',
    category: 'navigation',
    keys: [chord('Ctrl+O')],
    presetKeys: { onenote: [chord('Ctrl+E'), chord('Ctrl+O')] },
    allowInTextInput: true,
    allowInModal: true,
    run: () => togglePalette('switcher'),
  }),
);

paletteProviders.register(commandsProvider);
paletteProviders.register(nodesProvider({ id: 'app.nodes', pagesOnly: false }));

trackRecentPages();
if (typeof window !== 'undefined') preloadWhenIdle();
