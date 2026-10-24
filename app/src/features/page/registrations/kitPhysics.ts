// The physics tools lane's registrations: a palette command that opens the physics tools window, and one per tool
// that opens it on that tool's tab. This file loads at start-up, so it holds only definitions; the window and each
// tool load on first use. The list matches features/tools/physics/meta.ts, which a test checks.
import { commandBar, commands } from '../../../registries';
import type { MessageKey } from '../../../strings/t';

export const PHYSICS_COMMAND_TOOLS: readonly (readonly [id: string, icon: string])[] = [
  ['waves', 'WaveSine'],
  ['geooptics', 'Eyeglasses'],
  ['waveoptics', 'Rainbow'],
  ['relativity', 'HourglassMedium'],
];

const open = async (tool: string | null) => (await import('../../tools')).openPhysicsTool(tool);

commands.register({
  id: 'tools.kitPhysics',
  title: 'kitPhysics.open',
  keywords: 'kitPhysics.keywords',
  category: 'general',
  icon: 'Atom',
  flag: 'kits.physics',
  when: () => true,
  run: () => open(null),
});
commandBar.register({
  id: 'tools.kitPhysics',
  tab: 'insert',
  group: 'math',
  command: 'tools.kitPhysics',
  flag: 'kits.physics',
  priority: 20,
});

for (const [tool, icon] of PHYSICS_COMMAND_TOOLS) {
  commands.register({
    id: `tools.physics.${tool}`,
    title: `kitPhysics.${tool}.open` as MessageKey,
    keywords: `kitPhysics.${tool}.keywords` as MessageKey,
    category: 'general',
    icon,
    flag: 'kits.physics',
    when: () => true,
    run: () => open(tool),
  });
}
