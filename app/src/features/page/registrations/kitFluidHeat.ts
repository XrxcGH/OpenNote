// The fluid and heat transfer kit's commands: one to open the window and one for each tool, so a tool is found by its
// subject words in the command palette. This file loads at start-up, so it holds only definitions; the window and
// its tools load on first use.
import { FLUIDHEAT_TOOLS } from '../../engineering/flags';
import { addCommand } from './qolStudy';

const open = async (tool?: string) => (await import('../../engineering')).openFluidHeatKit(tool);

addCommand({
  id: 'tools.kit-fluidheat',
  title: 'kitFluidHeat.open',
  keywords: 'kitFluidHeat.keywords',
  category: 'general',
  icon: 'Drop',
  flag: 'kits.fluidheat',
  anywhere: true,
  run: () => open(),
});

// A live calculation block's Open in tool puts the block's texts and units back, then opens the tool.
if (typeof window !== 'undefined') {
  // Best effort: a chunk that fails to load leaves Open in tool unavailable, and the commands still work.
  void import('../../tools')
    .then((tools) => tools.registerFormKit('fluidheat', 'opennote.tools.kitFluidHeat.', (tool) => open(tool)))
    .catch(() => undefined);
}

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
