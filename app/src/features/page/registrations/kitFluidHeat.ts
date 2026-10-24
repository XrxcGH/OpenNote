// The fluid and heat transfer kit's commands: one to open the window and one for each tool, so a tool is found by its
// subject words in the command palette. This file loads at start-up, so it holds only definitions; the window and
// its tools load on first use.
import { FLUIDHEAT_TOOLS } from '../../engineering/flags';
import { addCommand } from './qolStudy';

const open = async (tool?: string) => (await import('../../engineering')).openFluidHeatKit(tool);

addCommand({
  id: 'tools.kitFluidHeat',
  title: 'kitFluidHeat.open',
  keywords: 'kitFluidHeat.keywords',
  category: 'general',
  icon: 'Drop',
  flag: 'kits.fluidheat',
  anywhere: true,
  run: () => open(),
});

for (const tool of FLUIDHEAT_TOOLS) {
  addCommand({
    id: `tools.kitFluidHeat.${tool.id}`,
    title: tool.title,
    keywords: tool.keywords,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.fluidheat',
    anywhere: true,
    run: () => open(tool.id),
  });
}
