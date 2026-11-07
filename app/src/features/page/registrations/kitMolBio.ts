// The molecular biology kit's commands: one to open the window (tools.kitmolbio, the id every tool window's command
// takes so the shortcut editor lists it), and one per tool that opens it on that tool.
import { startUp } from '../../../boot/startUp';
import { MOLBIO_TOOLS } from '../../tools/flags';
import type { MessageKey } from '../../../strings/t';
import { addCommand } from './qolStudy';

addCommand({
  id: 'tools.kitmolbio',
  title: 'kitMolBio.open',
  keywords: 'kitMolBio.openKeywords',
  category: 'general',
  icon: 'Dna',
  flag: 'kits.molbio',
  anywhere: true,
  run: async () => (await import('../../tools')).openMolBio(),
});

// A live calculation block's Open in tool opens the window on the block's tool and puts its values back.
if (typeof window !== 'undefined') {
  // Best effort: a chunk that fails to load leaves Open in tool unavailable, and the commands still work.
  void startUp(import('../../tools'))
    .then((tools) =>
      tools.registerKit('molbio', async (tool) => {
        await (await import('../../tools')).openMolBio(MOLBIO_TOOLS.find((one) => one.id === tool)?.id);
      }),
    )
    .catch(() => undefined);
}

for (const tool of MOLBIO_TOOLS) {
  addCommand({
    id: `kits.molbio.${tool.id}`,
    title: `kitMolBio.${tool.id}.title` as MessageKey,
    keywords: `kitMolBio.${tool.id}.keywords` as MessageKey,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.molbio',
    anywhere: true,
    run: async () => (await import('../../tools')).openMolBio(tool.id),
  });
}
