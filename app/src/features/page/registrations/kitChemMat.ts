// The palette commands of the Chemistry and materials window: one to open the window, and one per tool that opens it
// on that tool. This file loads at start-up, so it holds only definitions; the window loads on first use.
import { startUp } from '../../../boot/startUp';
import { addCommand } from './qolStudy';
import { CHEMMAT_META } from '../../tools/flags';

addCommand({
  id: 'tools.kit-chemmat',
  title: 'kitChemMat.open',
  keywords: 'kitChemMat.keywords',
  category: 'general',
  icon: 'Flask',
  flag: 'kits.chemmat',
  anywhere: true,
  run: async () => (await import('../../tools')).openTool('kit-chemmat'),
});

// A live calculation block's Open in tool opens the window on the block's tool and puts its values back.
if (typeof window !== 'undefined') {
  // Best effort: a chunk that fails to load leaves Open in tool unavailable, and the commands still work.
  void startUp(import('../../tools'))
    .then((tools) => tools.registerKit('chemmat', async (tool) => (await import('../../tools')).openChemMatTool(tool)))
    .catch(() => undefined);
  // The Chemistry calculators keep their answers the same way, under a kit of their own.
  void startUp(import('../../tools'))
    .then((tools) => tools.registerKit('chemcalc', async (tab) => (await import('../../tools')).openChemCalc(tab)))
    .catch(() => undefined);
}

for (const tool of CHEMMAT_META) {
  addCommand({
    id: `tools.kitChemMat.${tool.id}`,
    title: tool.open,
    keywords: tool.keywords,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.chemmat',
    anywhere: true,
    run: async () => (await import('../../tools')).openChemMatTool(tool.id),
  });
}
