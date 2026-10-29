// The aerospace kit's commands: one to open the window, and one per tool that opens it on that tool.
import { AERO_TOOLS, type AeroToolId } from '../../engineering/flags';
import { addCommand } from './qolStudy';

// This file loads at start-up, so the window and its tools load on first use.
const openAeroKit = async (tool?: AeroToolId) => (await import('../../engineering')).openAeroKit(tool);

addCommand({
  id: 'tools.kitaero',
  title: 'kitAero.open',
  keywords: 'kitAero.openKeywords',
  category: 'general',
  icon: 'AirplaneInFlight',
  flag: 'kits.aero',
  anywhere: true,
  run: () => openAeroKit(),
});

for (const tool of AERO_TOOLS) {
  addCommand({
    id: `kits.aero.${tool.id}`,
    title: `kitAero.t.${tool.id}.title`,
    keywords: `kitAero.t.${tool.id}.keywords`,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.aero',
    anywhere: true,
    run: () => openAeroKit(tool.id),
  });
}
