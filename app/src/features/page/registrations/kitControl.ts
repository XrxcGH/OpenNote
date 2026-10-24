// The dynamics and control kit's commands: one to open the window and one for each tool, so a tool is found by its
// subject words in the command palette. This file loads at start-up, so it holds only definitions; the window and
// its tools load on first use.
import { CONTROL_TOOLS } from '../../engineering/flags';
import { addCommand } from './qolStudy';

const open = async (tool?: string) => (await import('../../engineering')).openControlKit(tool);

addCommand({
  id: 'tools.kitControl',
  title: 'kitControl.open',
  keywords: 'kitControl.keywords',
  category: 'general',
  icon: 'ChartLine',
  flag: 'kits.control',
  anywhere: true,
  run: () => open(),
});

for (const tool of CONTROL_TOOLS) {
  addCommand({
    id: `tools.kitControl.${tool.id}`,
    title: tool.title,
    keywords: tool.keywords,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.control',
    anywhere: true,
    run: () => open(tool.id),
  });
}
