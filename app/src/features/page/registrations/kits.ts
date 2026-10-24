// The tool kits' shared registrations: the live calculation block that any kit tool can put on a page. Each subject
// kit registers its own window and palette commands in its own file. Only definitions load at start-up; the block's
// code loads when a page shows one.
import { PANEL_TYPES, panelRenderer } from '../panels/kinds';
import { blockRenderers } from '../registries';

blockRenderers.register(
  panelRenderer({
    type: PANEL_TYPES.kitCalc,
    label: 'kits.block.label',
    flag: 'kits.calc',
    load: async () => {
      const { mountKitCalc } = await (await import('../../tools')).loadKits();
      return { mount: (container, props) => mountKitCalc(container, props) };
    },
  }),
);
