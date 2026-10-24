// The civil, environmental, and chemical engineering kit's palette commands: one per tool, each opening the kit
// window on that tool. The list comes from the kit's meta module, which holds names and icons only, so nothing else
// of the kit loads until a command runs.
import { commands } from '../../../registries';
import type { MessageKey } from '../../../strings/t';
import { CIVIL_ICONS, CIVIL_TOOL_IDS } from '../../tools';

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
