// The engineering mathematics kit's commands: one to open the window and one for each tool, so a tool is found by
// its subject words in the command palette. This file loads at start-up, so it holds only definitions; the window
// loads on first use.
import { startUp } from '../../../boot/startUp';
import { MATH_TOOLS } from '../../tools/flags';
import { addCommand } from './qolStudy';

addCommand({
  id: 'tools.kit-math',
  title: 'kitMath.open',
  keywords: 'kitMath.keywords',
  category: 'general',
  icon: 'Atom',
  flag: 'kits.math',
  anywhere: true,
  run: async () => (await import('../../tools')).openMathKit(),
});

// A live calculation block's Open in tool opens the window on the block's tool and puts its values back.
if (typeof window !== 'undefined') {
  // Best effort: a chunk that fails to load leaves Open in tool unavailable, and the commands still work.
  void startUp(import('../../tools'))
    .then((tools) => tools.registerKit('math', async (tool) => (await import('../../tools')).openMathKit(tool)))
    .catch(() => undefined);
}

for (const tool of MATH_TOOLS) {
  addCommand({
    id: `tools.kitMath.${tool.id}`,
    title: tool.title,
    keywords: tool.keywords,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.math',
    anywhere: true,
    run: async () => (await import('../../tools')).openMathKit(tool.id),
  });
}
