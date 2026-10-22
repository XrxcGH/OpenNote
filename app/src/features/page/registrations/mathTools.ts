// The calculator and graphing lane's registrations: the 3D graph block, the calculator's modes, and the Graph and
// Steps actions on an equation. This file loads at start-up, so it holds only definitions; each command loads its
// feature on first use.
import { commandBar, commands } from '../../../registries';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { targetEditor } from '../formattingBar/target';
import { slashItems } from '../registries';

const inEditor = () => targetEditor() !== null;

/** The first text of a new 3D graph block. */
export const FIRST_3D = 'z = sin(x) cos(y)';

commands.register({
  id: 'insert.graph3d',
  title: 'mathTools.graph3d.insert',
  keywords: 'mathTools.graph3d.insertKeywords',
  category: 'insert',
  icon: 'ChartLine',
  flag: 'math.graph3d',
  when: inEditor,
  run: async () => {
    const editor = targetEditor();
    if (!editor) return;
    const { insertGraph } = await import('../../../editor/extensions/graphFence');
    if (insertGraph(editor, FIRST_3D) !== null) announce(t('smart.grapher.announceInserted'));
  },
});
slashItems.register({
  id: 'insert.graph3d',
  title: 'mathTools.graph3d.insert',
  keywords: 'mathTools.graph3d.insertKeywords',
  icon: 'ChartLine',
  flag: 'math.graph3d',
  command: 'insert.graph3d',
  group: 'advanced',
  order: 23,
});
commandBar.register({
  id: 'insert.graph3d',
  tab: 'insert',
  group: 'math',
  command: 'insert.graph3d',
  flag: 'math.graph3d',
  priority: 37,
});
