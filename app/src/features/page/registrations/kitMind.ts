// The psychology and behavior kit's commands: one to open the window and one for each tool, so a tool is found by
// its subject words in the command palette. This file loads at start-up, so it holds only definitions; the window
// and its tools load on first use.
import { startUp } from '../../../boot/startUp';
import { MIND_TOOLS } from '../../tools/flags';
import { addCommand } from './qolStudy';

const open = async (tool?: string) => (await import('../../tools')).openMindKit(tool);

// A live calculation block's Open in tool comes back through the kits' registry.
void startUp(import('../../tools')).then((tools) => tools.registerKit('mind', (tool) => open(tool)));

addCommand({
  id: 'tools.kit-mind',
  title: 'kitMind.open',
  keywords: 'kitMind.keywords',
  category: 'general',
  icon: 'Brain',
  flag: 'kits.mind',
  anywhere: true,
  run: () => open(),
});

for (const tool of MIND_TOOLS) {
  addCommand({
    id: `tools.kitMind.${tool.id}`,
    title: tool.title,
    keywords: tool.keywords,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.mind',
    anywhere: true,
    run: () => open(tool.id),
  });
}
