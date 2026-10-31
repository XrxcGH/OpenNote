// The earth sciences kit in the command palette: one command opens the kit window, and one per tool opens it at
// that tool. Only the tool list loads at start-up; the kit's code loads when its window first opens.
import type { MessageKey } from '../../../strings/t';
import { EARTH_TOOLS } from '../../tools/flags';
import { addCommand } from './qolStudy';

addCommand({
  id: 'tools.kit-earth',
  title: 'kitEarth.open',
  keywords: 'kitEarth.keywords',
  category: 'general',
  icon: 'GlobeHemisphereWest',
  flag: 'kits.earth',
  anywhere: true,
  run: async () => (await import('../../tools')).openEarthKit(),
});

for (const tool of EARTH_TOOLS) {
  addCommand({
    id: `kits.earth.${tool.id}`,
    title: `kitEarth.tools.${tool.id}.open` as MessageKey,
    keywords: `kitEarth.tools.${tool.id}.keywords` as MessageKey,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.earth',
    anywhere: true,
    run: async () => (await import('../../tools')).openEarthKit(tool.id),
  });
}
