// The palette commands of the Chemistry and materials window: one to open the window, and one per tool that opens it
// on that tool. This file loads at start-up, so it holds only definitions; the window loads on first use.
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
  run: async () => (await import('../../tools')).openChemMatTool(CHEMMAT_META[0].id),
});

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
