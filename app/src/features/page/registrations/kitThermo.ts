// The thermodynamics kit (flag kits.thermo, thermo lane): a palette command for the kit window and one for each of
// its tools. The list mirrors engineering/thermo/meta.ts, which this file cannot import at start-up without loading
// the engineering feature; each tool's title and keywords must exist in strings/en/kitThermo.ts to type-check.
import type { IconName } from '../../../ui/icons';
import { addCommand } from './qolStudy';

const TOOLS = [
  ['steam', 'CloudFog'],
  ['r134a', 'Snowflake'],
  ['idealgas', 'Cylinder'],
  ['realgas', 'Gauge'],
  ['devices', 'Fan'],
  ['cycles', 'ArrowsClockwise'],
  ['psychro', 'DropHalf'],
  ['statthermo', 'Atom'],
] as const satisfies readonly (readonly [string, IconName])[];

async function open(tool?: string): Promise<void> {
  await (await import('../../engineering')).openThermoTool(tool);
}

addCommand({
  id: 'tools.kitThermo',
  title: 'kitThermo.open.window',
  keywords: 'kitThermo.keywords.window',
  category: 'general',
  icon: 'Thermometer',
  flag: 'kits.thermo',
  anywhere: true,
  run: () => open(),
});

for (const [tool, icon] of TOOLS) {
  addCommand({
    id: `tools.kitThermo.${tool}`,
    title: `kitThermo.open.${tool}`,
    keywords: `kitThermo.keywords.${tool}`,
    category: 'general',
    icon,
    flag: 'kits.thermo',
    anywhere: true,
    run: () => open(tool),
  });
}
