// The design kit's commands: one to open the window and one for each tool, so a tool is found by its subject words in
// the command palette. This file loads at start-up, so it holds only definitions; the window and its tools load on
// first use. The tool ids are the ones in features/tools/design/meta.ts (a test keeps the two in step).
import { announce } from '../../../ui';
import { t } from '../../../strings/t';
import { addCommand } from './qolStudy';

const open = async (tool?: string) => (await import('../../tools')).openDesignKit(tool);

addCommand({
  id: 'tools.kit-design',
  title: 'kitDesign.open',
  keywords: 'kitDesign.keywords',
  category: 'general',
  icon: 'PencilRuler',
  flag: 'kits.design',
  anywhere: true,
  run: () => open(),
});

const TOOLS = [
  ['drafting', 'PencilRuler'],
  ['views', 'Box'],
  ['tolerances', 'Ruler'],
  ['machining', 'Wrench'],
  ['forming', 'Hammer'],
  ['microfab', 'Cpu'],
  ['memtrace', 'Waypoints'],
  ['numrep', 'Binary'],
  ['references', 'BookOpen'],
] as const;

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

// Engineering paper for the shown page: each puts its drawing on the page as one undo step.
const PAPERS = [
  ['computation', 'Grid3x3'],
  ['threeView', 'LayoutPanelTop'],
  ['titleBlock', 'Table2'],
] as const;

for (const [key, icon] of PAPERS) {
  addCommand({
    id: `tools.kitDesign.paper.${key}`,
    title: `kitDesign.paper.${key}`,
    keywords: 'kitDesign.paper.keywords',
    category: 'view',
    icon,
    flag: 'kits.design',
    anywhere: true,
    run: async () => {
      const applied = (await import('../../pages')).applyDraftingPaper(key);
      if (!applied) announce(t('kitDesign.paper.noPage'));
    },
  });
}
