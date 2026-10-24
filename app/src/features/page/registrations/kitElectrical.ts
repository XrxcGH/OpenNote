// The circuits and energy kit's commands. One opens the window; one per tool opens it on that tool.
/* eslint-disable opennote/feature-boundaries --
   The engineering index also pulls in the diagram and circuit solvers, which would join start-up.
   These two small files are all the commands need. */
import { ELECTRICAL_TOOLS } from '../../engineering/electrical/meta';
import { openKit as openElectricalKit } from '../../engineering/electrical/open';
import { addCommand } from './qolStudy';

addCommand({
  id: 'tools.kitelectrical',
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
