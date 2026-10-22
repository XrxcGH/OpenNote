// The mt3-graph-3d lane's registrations: Insert parametric or polar graph (Insert tab, slash
// menu, and palette), and the Vectors, Solids of revolution, and Projectile simulator tool windows (Insert tab and
// palette). This file loads at start-up, so it holds only definitions; each command loads its feature on first use.
import { commandBar, commands } from '../../../registries';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { slashItems } from '../registries';
import { canInsert, insertTarget } from './smart';

async function insertStarter(which: '3d' | 'curves'): Promise<void> {
  const editor = insertTarget();
  if (!editor) return;
  const [{ insertGraph }, math] = await Promise.all([
    import('../../../editor/extensions/graphFence'),
    import('../../math'),
  ]);
  const text = which === '3d' ? math.STARTER_3D : math.STARTER_CURVES;
  if (insertGraph(editor, text) !== null) {
    announce(t(which === '3d' ? 'graph3d.insert.announced3d' : 'graph3d.insert.announcedCurve'));
  }
}

for (const [id, title, keywords, icon, flag, which, order, priority] of [
  [
    'insert.curveGraph',
    'graph3d.insert.curve',
    'graph3d.insert.curveKeywords',
    'Spiral',
    'math.curves',
    'curves',
    24,
    36,
  ],
] as const) {
  commands.register({
    id,
    title,
    keywords,
    category: 'insert',
    icon,
    flag,
    when: canInsert,
    run: () => insertStarter(which),
  });
  slashItems.register({ id, title, keywords, icon, flag, command: id, group: 'advanced', order });
  commandBar.register({ id, tab: 'insert', group: 'math', command: id, flag, priority });
}

for (const [tool, flag, title, keywords, icon, priority] of [
  ['vectors', 'math.vectors', 'graph3d.tools.vectors.open', 'graph3d.tools.vectors.keywords', 'VectorThree', 35],
  ['solids', 'math.solids', 'graph3d.tools.solids.open', 'graph3d.tools.solids.keywords', 'Cylinder', 34],
  [
    'projectile',
    'math.projectile',
    'graph3d.tools.projectile.open',
    'graph3d.tools.projectile.keywords',
    'Basketball',
    33,
  ],
] as const) {
  const id = `tools.${tool}` as const;
  commands.register({
    id,
    title,
    keywords,
    category: 'general',
    icon,
    flag,
    when: () => true,
    run: async () => (await import('../../tools')).openTool(tool),
  });
  commandBar.register({ id, tab: 'insert', group: 'math', command: id, flag, priority });
}
