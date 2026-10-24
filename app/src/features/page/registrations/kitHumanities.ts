// The history, places, languages, and texts kit's palette commands: one that opens the kit, and one for each tool,
// made in a loop from the kit's tool list. This file loads at start-up, so it holds only definitions; the kit's
// code loads when a command first runs.
import type { MessageKey } from '../../../strings/t';
import { HUMANITIES_TOOLS } from '../../tools/flags';
import { addCommand } from './qolStudy';

addCommand({
  id: 'kits.humanities',
  title: 'kitHumanities.open',
  keywords: 'kitHumanities.keywords',
  category: 'general',
  icon: 'Books',
  flag: 'kits.humanities',
  anywhere: true,
  run: async () => (await import('../../tools')).openHumanitiesTool(HUMANITIES_TOOLS[0].id),
});

for (const tool of HUMANITIES_TOOLS) {
  addCommand({
    id: `kits.humanities.${tool.id}`,
    title: `kitHumanities.${tool.id}.open` as MessageKey,
    keywords: `kitHumanities.${tool.id}.keywords` as MessageKey,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.humanities',
    anywhere: true,
    run: async () => (await import('../../tools')).openHumanitiesTool(tool.id),
  });
}
