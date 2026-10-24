// The circuits and energy kit's commands: one to open the window, and one per tool that opens it on that tool.
import { ELECTRICAL_TOOLS, openElectricalKit } from '../../engineering';
import { addCommand } from './qolStudy';

addCommand({
  id: 'kits.electrical',
  title: 'kitElectrical.open',
  keywords: 'kitElectrical.openKeywords',
  category: 'general',
  icon: 'Lightning',
  flag: 'kits.electrical',
  anywhere: true,
  run: () => openElectricalKit(),
});

for (const tool of ELECTRICAL_TOOLS) {
  addCommand({
    id: `kits.electrical.${tool.id}`,
    title: `kitElectrical.t.${tool.id}.title`,
    keywords: `kitElectrical.t.${tool.id}.keywords`,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.electrical',
    anywhere: true,
    run: () => openElectricalKit(tool.id),
  });
}
