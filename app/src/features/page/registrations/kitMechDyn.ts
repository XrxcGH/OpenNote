// The mechanisms and dynamics kit's commands: one to open the window and one for each tool, so a tool is found by
// its subject words in the command palette. This file loads at start-up, so it holds only definitions; the window
// and its tools load on first use.
import { MECHDYN_TOOLS } from '../../engineering/flags';
import { PANEL_TYPES, panelRenderer } from '../panels/kinds';
import { blockRenderers } from '../registries';
import { lazyHandle } from './engineering';
import { addCommand } from './qolStudy';

// A calculation block from the kit's Insert menu: the answer on the page, and a button that reopens the tool.
blockRenderers.register(
  panelRenderer({
    type: PANEL_TYPES.mechDynCalc,
    label: 'kitMechDyn.ui.calcBlock',
    flag: 'kits.mechdyn',
    load: async () => {
      const { mountMechDynCalc } = await import('../../engineering');
      return { mount: (container, props) => lazyHandle(mountMechDynCalc(container, props)) };
    },
  }),
);

const open = async (tool?: string) => (await import('../../engineering')).openMechDynKit(tool);

addCommand({
  id: 'tools.kit-mechdyn',
  title: 'kitMechDyn.open',
  keywords: 'kitMechDyn.keywords',
  category: 'general',
  icon: 'Gear',
  flag: 'kits.mechdyn',
  anywhere: true,
  run: () => open(),
});

for (const tool of MECHDYN_TOOLS) {
  addCommand({
    id: `tools.kitMechDyn.${tool.id}`,
    title: tool.title,
    keywords: tool.keywords,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.mechdyn',
    anywhere: true,
    run: () => open(tool.id),
  });
}
