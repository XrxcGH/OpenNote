// The solid mechanics kit's commands: one to open the window and one for each tool, so a tool is found by its
// subject words in the command palette. This file loads at start-up, so it holds only definitions; the window and
// its tools load on first use.
import { SOLIDS_TOOLS } from '../../engineering/flags';
import { addCommand } from './qolStudy';

const open = async (tool?: string) => (await import('../../engineering')).openSolidsKit(tool);

addCommand({
  id: 'tools.kitSolids',
  title: 'kitSolids.open',
  keywords: 'kitSolids.keywords',
  category: 'general',
  icon: 'Bridge',
  flag: 'kits.solids',
  anywhere: true,
  run: () => open(),
});

for (const tool of SOLIDS_TOOLS) {
  addCommand({
    id: `tools.kitSolids.${tool.id}`,
    title: tool.title,
    keywords: tool.keywords,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.solids',
    anywhere: true,
    run: () => open(tool.id),
  });
}
