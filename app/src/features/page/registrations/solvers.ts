// The Math solvers window (flag math.solvers, calc-solvers lane): a palette command for the window and one for each
// solver, a keyboard shortcut, and an Insert tab button. Each command loads the window on first use.
import type { IconName } from '../../../ui/icons';
import { addCommand } from './qolStudy';

const TABS: readonly (readonly [string, IconName])[] = [
  ['integrals', 'Sigma'],
  ['equations', 'ChartLine'],
  ['transforms', 'Function'],
  ['series', 'Function'],
  ['roots', 'ChartLine'],
  ['errors', 'Percent'],
  ['probability', 'ChartBar'],
  ['matrices', 'Table'],
  ['projectile', 'ChartLine'],
];

async function open(tab?: string): Promise<void> {
  if (tab) await (await import('../../math')).chooseSolverTab(tab);
  (await import('../../tools')).openTool('solvers');
}

addCommand({
  id: 'tools.solvers',
  title: 'solvers.open.window',
  keywords: 'solvers.keywords.window',
  category: 'general',
  icon: 'MathOperations',
  flag: 'math.solvers',
  anywhere: true,
  keys: ['Ctrl+Alt+Shift+M'],
  bar: { group: 'study', priority: 31 },
  run: () => open(),
});

for (const [tab, icon] of TABS) {
  addCommand({
    id: `tools.solvers.${tab}`,
    title: `solvers.open.${tab}` as Parameters<typeof addCommand>[0]['title'],
    keywords: `solvers.keywords.${tab}` as Parameters<typeof addCommand>[0]['title'],
    category: 'general',
    icon,
    flag: 'math.solvers',
    anywhere: true,
    run: () => open(tab),
  });
}
