// The life science tools' registrations: a palette command that opens the window, and one per tool that opens it
// at that tool, made in a loop from the tool list. The window and every tool load only when opened.
import { LIFESYS_TOOLS } from '../../tools/flags';
import { addCommand } from './qolStudy';

// One import site for the tools chunk, so start-up carries its preload list once.
const tools = () => import('../../tools');

addCommand({
  id: 'tools.lifesys',
  title: 'kitLifeSys.ui.open',
  keywords: 'kitLifeSys.ui.keywords',
  category: 'general',
  icon: 'Leaf',
  flag: 'kits.lifesys',
  anywhere: true,
  run: async () => (await tools()).openLifeSys(),
});

for (const tool of LIFESYS_TOOLS) {
  addCommand({
    id: `lifesys.${tool.id}`,
    title: tool.title,
    keywords: tool.keywords,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.lifesys',
    anywhere: true,
    run: async () => (await tools()).openLifeSys(tool.id),
  });
}

// A live calculation block (ext:org.opennote/kitcalc) made by the life science window keeps the tool, the
// calculation, and the typed values; its Open in tool comes back here through the kit registry. Best effort: a chunk
// that fails to load leaves Open in tool unavailable, and the commands still work.
if (typeof window !== 'undefined') {
  void tools()
    .then((chunk) => chunk.registerKit('lifesys', (tool) => chunk.reopenLifeSys(tool)))
    .catch(() => undefined);
}
