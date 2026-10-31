// The molecular biology kit's commands: one to open the window (tools.kitmolbio, the id every tool window's command
// takes so the shortcut editor lists it), and one per tool that opens it on that tool.
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
