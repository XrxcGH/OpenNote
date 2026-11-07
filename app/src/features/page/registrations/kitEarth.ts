// The earth sciences kit in the command palette: one command opens the kit window, and one per tool opens it at
// that tool. Only the tool list loads at start-up; the kit's code loads when its window first opens.
import type { MessageKey } from '../../../strings/t';
import { startUp } from '../../../boot/startUp';
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

// A live calculation block's Open in tool opens the window on the block's tool and puts its values back.
if (typeof window !== 'undefined') {
  // Best effort: a chunk that fails to load leaves Open in tool unavailable, and the commands still work.
  void startUp(import('../../tools'))
    .then((tools) =>
      tools.registerKit('earth', async (tool) => {
        const known = EARTH_TOOLS.find((one) => one.id === tool);
        await (await import('../../tools')).openEarthKit(known?.id);
      }),
    )
    .catch(() => undefined);
}

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
