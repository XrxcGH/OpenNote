// The solid mechanics kit's commands: one to open the window and one for each tool, so a tool is found by its
// subject words in the command palette. This file loads at start-up, so it holds only definitions; the window and
// its tools load on first use.
import { startUp } from '../../../boot/startUp';
import { CALC_EVENT, SOLIDS_TOOLS, type KitCalcRequest } from '../../engineering/flags';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { PANEL_TYPES } from '../panels/kinds';
import { addCommand } from './qolStudy';

const open = async (tool?: string) => (await import('../../engineering')).openSolidsKit(tool);

addCommand({
  id: 'tools.kit-solids',
  title: 'kitSolids.open',
  keywords: 'kitSolids.keywords',
  category: 'general',
  icon: 'Bridge',
  flag: 'kits.solids',
  anywhere: true,
  run: () => open(),
});

// A live calculation goes in the kits' shared block (registrations/kits.ts). It keeps the tool and its answer. Its
// inputs are the typed values and the unit system. The block's Open in tool comes back here through the kit registry.
const reopen = async (tool: string) => {
  const engineering = await import('../../engineering');
  const inputs = (await import('../../tools')).takeKitInputs('solids', tool);
  const calc = inputs && typeof inputs === 'object' ? engineering.readSolidsCalc({ ...inputs, tool }) : null;
  await (calc ? engineering.reopenSolidsCalc(calc) : engineering.openSolidsKit(tool));
};

if (typeof window !== 'undefined') {
  // Best effort: a chunk that fails to load leaves Open in tool unavailable, and the commands still work.
  void startUp(import('../../tools'))
    .then((tools) => tools.registerKit('solids', reopen))
    .catch(() => undefined);
  window.addEventListener(CALC_EVENT, (event) => {
    const request = (event as CustomEvent<KitCalcRequest>).detail;
    request.handled = true;
    const { tool, texts, system, summary, latex } = request.data;
    const title = SOLIDS_TOOLS.find((one) => one.id === tool)?.title;
    const data = { kit: 'solids', tool, title: title ? t(title) : tool, summary, inputs: { texts, system }, latex };
    void (async () => {
      const { insertPanelBlock } = await import('../panels/insertPanel');
      const id = await insertPanelBlock(PANEL_TYPES.kitCalc, data, request.fallback);
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
