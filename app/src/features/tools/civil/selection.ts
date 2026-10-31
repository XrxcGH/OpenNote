// Which tool and calculation the kit window shows. A palette command sets it before it opens the window, and the
// window remembers it for next time.
import { createStore } from '../../../state/store';
import { loadStored, saveStored } from '../ui/storage';
import { CIVIL_TOOL_IDS, isCivilToolId } from './meta';
import type { CivilToolId } from './meta';

export interface CivilChoice {
  tool: CivilToolId;
  calcs: Readonly<Partial<Record<CivilToolId, string>>>;
}

const STORE = 'kit-civil';

function saved(): CivilChoice {
  const stored = loadStored<Partial<CivilChoice>>(STORE, {});
  return {
    tool: isCivilToolId(stored.tool) ? stored.tool : CIVIL_TOOL_IDS[0],
    calcs: typeof stored.calcs === 'object' && stored.calcs ? stored.calcs : {},
  };
}

export const civilChoice = createStore<CivilChoice>(saved(), 'kit civil choice');

export function choose(tool: CivilToolId, calc?: string): void {
  civilChoice.set((current) => ({ tool, calcs: calc ? { ...current.calcs, [tool]: calc } : current.calcs }));
  saveStored(STORE, civilChoice.get());
}
