// Which earth kit tool and calculation the window shows. It is remembered on this device, and a palette command
// can set it before the window opens.
import { createStore } from '../../../state/store';
import { loadStored, saveStored } from '../ui/storage';
import { EARTH_TOOL_IDS, isEarthTool } from './meta';
import type { EarthToolId } from './meta';

interface Choice {
  tool: EarthToolId;
  modes: Partial<Record<EarthToolId, string>>;
}

const STORE = 'kit-earth';

function first(): Choice {
  const saved = loadStored<Partial<Choice>>(STORE, {});
  return {
    tool: isEarthTool(saved.tool) ? saved.tool : EARTH_TOOL_IDS[0],
    modes: typeof saved.modes === 'object' && saved.modes ? saved.modes : {},
  };
}

export const earthChoice = createStore<Choice>(first(), 'earth kit');

export function chooseTool(tool: EarthToolId): void {
  earthChoice.set((current) => ({ ...current, tool }));
  saveStored(STORE, earthChoice.get());
}

export function chooseMode(tool: EarthToolId, mode: string): void {
  earthChoice.set((current) => ({ ...current, modes: { ...current.modes, [tool]: mode } }));
  saveStored(STORE, earthChoice.get());
}
