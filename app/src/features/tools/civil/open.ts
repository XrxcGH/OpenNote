// Opens the kit window on one tool. The palette commands load this module when they run.
import { choose } from './selection';
import type { CivilToolId } from './meta';

export async function openCivilTool(tool: CivilToolId): Promise<void> {
  choose(tool);
  (await import('../ui/host')).openTool('kit-civil');
}
