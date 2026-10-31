// The civil, environmental, and chemical engineering kit's palette commands: one per tool, each opening the kit
// window on that tool. The list comes from the kit's meta module, which holds names and icons only, so nothing else
// of the kit loads until a command runs.
import { startUp } from '../../../boot/startUp';
import { commands } from '../../../registries';
import type { MessageKey } from '../../../strings/t';
import { CIVIL_ICONS, CIVIL_TOOL_IDS } from '../../tools/flags';

commands.register({
  id: 'tools.kit-civil',
  title: 'kitCivil.title',
  keywords: 'kitCivil.openKeywords',
  category: 'general',
  icon: 'Bridge',
  flag: 'kits.civil',
  run: async () => (await import('../../tools')).openTool('kit-civil'),
});

for (const id of CIVIL_TOOL_IDS) {
  commands.register({
    id: `kitCivil.${id}`,
    title: `kitCivil.tools.${id}.open` as MessageKey,
    keywords: `kitCivil.tools.${id}.keywords` as MessageKey,
    category: 'general',
    icon: CIVIL_ICONS[id],
    flag: 'kits.civil',
    run: async () => (await import('../../tools')).openCivilTool(id),
  });
}

// A live calculation block's Open in tool comes back here through the kit registry (features/tools/civil/open.ts).
if (typeof window !== 'undefined') {
  // Best effort: a chunk that fails to load leaves Open in tool unavailable, and the commands still work.
  void startUp(import('../../tools'))
    .then((tools) => tools.registerKit('civil', (key) => tools.reopenCivilCalc(key)))
    .catch(() => undefined);
}
