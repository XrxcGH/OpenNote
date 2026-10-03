// A command whose shared chord refines another package's command (owner: WP6). Add row below and Leave the code
// block share Ctrl+Enter with Check or uncheck, which WP4 registers (ARCHITECTURE.md section 22.1). Each package
// registers on its own schedule, so the refinement reads the registry when asked: it names the other command once
// that command exists, and until then there is nothing to refine and no chord to share.
import type { CommandDef } from '../../../commands/types';
import { commands } from '../../../registries';

export function lateRefines<Args>(def: CommandDef<Args>): CommandDef<Args> {
  const target = def.refines;
  if (!target) return def;
  const late = { ...def };
  delete late.refines;
  Object.defineProperty(late, 'refines', {
    enumerable: true,
    get: () => (commands.get(target) ? target : undefined),
  });
  return late;
}
