// The economics and finance window: one command in the palette and the Insert tab opens it.
import { addCommand } from './qolStudy';

addCommand({
  id: 'tools.econ',
  title: 'kitEcon.open',
  keywords: 'kitEcon.keywords',
  category: 'general',
  icon: 'ChartLine',
  flag: 'tools.econ',
  anywhere: true,
  bar: { group: 'math', priority: 55 },
  run: async () => (await import('../../tools')).openTool('econ'),
});
