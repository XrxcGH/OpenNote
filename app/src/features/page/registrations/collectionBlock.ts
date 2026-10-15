// The live collection block: pages chosen by a collection's rules, shown inside a page and kept up to date. It
// registers the block, and an Insert command with a slash item and an Insert tab button.
import { announce } from '../../../ui';
import { PANEL_TYPES, panelRenderer } from '../panels/kinds';
import { blockRenderers } from '../registries';
import { addCommand } from './qolStudy';

blockRenderers.register(
  panelRenderer({
    type: PANEL_TYPES.collection,
    label: 'qolSearch.collections.block',
    flag: 'collections.block',
    load: async () => {
      const { mountCollection } = await import('../../collections');
      return { mount: (container, props) => mountCollection(container, props) };
    },
  }),
);

addCommand({
  id: 'insert.collection',
  title: 'qolSearch.collections.insert',
  keywords: 'qolSearch.collections.insertKeywords',
  icon: 'Table',
  flag: 'collections.block',
  slash: { group: 'advanced', order: 34 },
  bar: { group: 'study', priority: 30 },
  run: async () => {
    const { chooseCollection, collectionFallback } = await import('../../collections');
    const def = await chooseCollection();
    if (!def) return;
    const { insertPanelBlock } = await import('../panels/insertPanel');
    const id = await insertPanelBlock(PANEL_TYPES.collection, { def }, collectionFallback(def));
    if (id) announce(`${def.name}`);
  },
});
