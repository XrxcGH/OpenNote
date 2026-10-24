// The solid mechanics kit's commands: one to open the window and one for each tool, so a tool is found by its
// subject words in the command palette. This file loads at start-up, so it holds only definitions; the window and
// its tools load on first use.
import { CALC_EVENT, SOLIDS_TOOLS, type KitCalcRequest } from '../../engineering/flags';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { PANEL_TYPES, panelRenderer } from '../panels/kinds';
import { blockRenderers } from '../registries';
import { lazyHandle } from './engineering';
import { addCommand } from './qolStudy';

const open = async (tool?: string) => (await import('../../engineering')).openSolidsKit(tool);

addCommand({
  id: 'tools.kitSolids',
  title: 'kitSolids.open',
  keywords: 'kitSolids.keywords',
  category: 'general',
  icon: 'Bridge',
  flag: 'kits.solids',
  anywhere: true,
  run: () => open(),
});

// A live calculation: the tool, its typed values, and its answer, kept in the page so it can be opened again.
blockRenderers.register(
  panelRenderer({
    type: PANEL_TYPES.kitCalc,
    label: 'kitSolids.calc.block',
    flag: 'kits.solids',
    load: async () => {
      const { mountKitCalc } = await import('../../engineering');
      return { mount: (container, props) => lazyHandle(mountKitCalc(container, props)) };
    },
  }),
);

if (typeof window !== 'undefined') {
  window.addEventListener(CALC_EVENT, (event) => {
    const request = (event as CustomEvent<KitCalcRequest>).detail;
    request.handled = true;
    void (async () => {
      const { insertPanelBlock } = await import('../panels/insertPanel');
      const id = await insertPanelBlock(PANEL_TYPES.kitCalc, { ...request.data }, request.fallback);
      announce(t(id ? 'kitSolids.ui.inserted' : 'kitSolids.ui.noPage'));
    })();
  });
}

for (const tool of SOLIDS_TOOLS) {
  addCommand({
    id: `tools.kitSolids.${tool.id}`,
    title: tool.title,
    keywords: tool.keywords,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.solids',
    anywhere: true,
    run: () => open(tool.id),
  });
}
