// The life science tools' registrations: a palette command that opens the window, and one per tool that opens it
// at that tool, made in a loop from the tool list. The window and every tool load only when opened.
import { LIFESYS_TOOLS } from '../../tools/flags';
import { addCommand } from './qolStudy';

addCommand({
  id: 'tools.lifesys',
  title: 'kitLifeSys.ui.open',
  keywords: 'kitLifeSys.ui.keywords',
  category: 'general',
  icon: 'Leaf',
  flag: 'kits.lifesys',
  anywhere: true,
  run: async () => (await import('../../tools')).openLifeSys(),
});

for (const tool of LIFESYS_TOOLS) {
  addCommand({
    id: `lifesys.${tool.id}`,
    title: tool.title,
    keywords: tool.keywords,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.lifesys',
    anywhere: true,
    run: async () => (await import('../../tools')).openLifeSys(tool.id),
  });
}
