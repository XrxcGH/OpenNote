// Code cells' registrations (features/codecells; flag math.codeCells): the block, and Insert code cell in the
// Insert tab, the slash menu, the command palette, and Ctrl+Alt+Shift+K. This file loads at start-up, so it holds
// only definitions; the cell and its sandbox load on first use.
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { PANEL_TYPES, panelRenderer } from '../panels/kinds';
import { blockRenderers } from '../registries';
import { addCommand } from './qolStudy';

blockRenderers.register(
  panelRenderer({
    type: PANEL_TYPES.codeCell,
    label: 'codeCells.block',
    flag: 'math.codeCells',
    load: async () => {
      const { mountCodeCell } = await import('../../codecells');
      return { mount: (container, props) => mountCodeCell(container, props) };
    },
  }),
);

addCommand({
  id: 'insert.codeCell',
  title: 'codeCells.insert',
  keywords: 'codeCells.insertKeywords',
  icon: 'Terminal',
  flag: 'math.codeCells',
  keys: ['Ctrl+Alt+Shift+K'],
  slash: { group: 'advanced', order: 34 },
  bar: { group: 'math', priority: 35 },
  run: async () => {
    const { fallbackOf } = await import('../../codecells');
    const { insertPanelBlock } = await import('../panels/insertPanel');
    const source = t('codeCells.starter.python');
    const id = await insertPanelBlock(
      PANEL_TYPES.codeCell,
      { language: 'python', source },
      fallbackOf('python', source),
    );
    if (id) announce(t('codeCells.inserted'));
  },
});
