// The statistical models kit's commands: one to open the window and one for each tool, so a tool is found by its
// subject words in the command palette. This file loads at start-up, so it holds only definitions; the window and
// its tools load on first use.
import { STATMODELS_TOOLS } from '../../tools/flags';
import { addCommand } from './qolStudy';

const open = async (tool?: string) => (await import('../../tools')).openStatModelsKit(tool);

addCommand({
  // The window's command follows the tools.<window id> rule, so the shortcut editor lists it with the other windows.
  id: 'tools.kit-statmodels',
  title: 'kitStatModels.open',
  keywords: 'kitStatModels.keywords',
  category: 'general',
  icon: 'ChartScatter',
  flag: 'kits.statmodels',
  anywhere: true,
  run: () => open(),
});

for (const tool of STATMODELS_TOOLS) {
  addCommand({
    id: `tools.kitStatModels.${tool.id}`,
    title: tool.title,
    keywords: tool.keywords,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.statmodels',
    anywhere: true,
    run: () => open(tool.id),
  });
}
