// The design kit's commands: one to open the window and one for each tool, so a tool is found by its subject words in
// the command palette. This file loads at start-up, so it holds only definitions; the window and its tools load on
// first use. The tool ids are the ones in features/tools/design/meta.ts (a test keeps the two in step).
import { addCommand } from './qolStudy';

const open = async (tool?: string) => (await import('../../tools')).openDesignKit(tool);

addCommand({
  id: 'tools.kitDesign',
  title: 'kitDesign.open',
  keywords: 'kitDesign.keywords',
  category: 'general',
  icon: 'PencilRuler',
  flag: 'kits.design',
  anywhere: true,
  run: () => open(),
});

const TOOLS = [['tolerances', 'Ruler']] as const;

for (const [id, icon] of TOOLS) {
  addCommand({
    id: `tools.kitDesign.${id}`,
    title: `kitDesign.${id}.title`,
    keywords: `kitDesign.${id}.keywords`,
    category: 'general',
    icon,
    flag: 'kits.design',
    anywhere: true,
    run: () => open(id),
  });
}
