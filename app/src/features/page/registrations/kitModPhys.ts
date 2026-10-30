// The modern physics and astronomy tools: a palette command for the window (the tool windows' shortcut list needs
// one per window) and one per tool, each opening the shared window on it.
// Only the list of tools loads at start-up; the window and its engines load when a command runs.
import { MODPHYS_TOOLS } from '../../tools/flags';
import { addCommand } from './qolStudy';

addCommand({
  id: 'tools.kit-modphys',
  title: 'kitModPhys.window.open',
  keywords: 'kitModPhys.window.keywords',
  category: 'general',
  icon: 'Atom',
  flag: 'kits.modphys',
  anywhere: true,
  run: async () => (await import('../../tools')).openModPhys(),
});

for (const tool of MODPHYS_TOOLS) {
  addCommand({
    id: `tools.modphys.${tool.id}`,
    title: `kitModPhys.tools.${tool.id}.open`,
    keywords: `kitModPhys.tools.${tool.id}.keywords`,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.modphys',
    anywhere: true,
    run: async () => (await import('../../tools')).openModPhys(tool.id),
  });
}
