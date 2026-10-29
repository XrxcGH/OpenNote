// The statistics kit (flag kits.statinfer): a palette command for the window and one for each tool, and the kit's
// registration so a live calculation block reopens its tool. Each command loads the kit the first time it runs. The
// list matches STAT_TOOLS in tools/statinfer/meta.ts (the kit's window test checks) and is kept here so the palette
// knows the commands without loading the tools.
import type { IconName } from '../../../ui/icons';
import { addCommand } from './qolStudy';

type Key = Parameters<typeof addCommand>[0]['title'];

export const STAT_COMMANDS: readonly (readonly [string, IconName])[] = [
  ['describe', 'ChartBar'],
  ['tables', 'Table'],
  ['epi', 'FirstAidKit'],
  ['correlation', 'ChartScatter'],
  ['ranks', 'Ranking'],
];

async function open(tool?: string): Promise<void> {
  const tools = await import('../../tools');
  if (tool) tools.selectKitTab('statinfer', tool);
  tools.openTool('kit-statinfer');
}

void import('../../tools').then((tools) => tools.registerKit('statinfer', open));

addCommand({
  id: 'tools.kit-statinfer',
  title: 'kitStatInfer.window.open',
  keywords: 'kitStatInfer.window.keywords',
  category: 'general',
  icon: 'ChartBar',
  flag: 'kits.statinfer',
  anywhere: true,
  run: () => open(),
});

for (const [tool, icon] of STAT_COMMANDS) {
  addCommand({
    id: `tools.kit-statinfer.${tool}`,
    title: `kitStatInfer.open.${tool}` as Key,
    keywords: `kitStatInfer.keywords.${tool}` as Key,
    category: 'general',
    icon,
    flag: 'kits.statinfer',
    anywhere: true,
    run: () => open(tool),
  });
}
