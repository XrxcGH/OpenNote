// Opens the circuits and energy window, on a tool if one is named. The tools module loads on first use so that
// registering the commands adds nothing to start-up.
import { KIT_STORE, KIT_TAB_EVENT } from './events';
import type { ElectricalToolId } from './meta';
import { loadStored, saveStored } from './store';

export async function openKit(tool?: ElectricalToolId): Promise<void> {
  if (tool) {
    saveStored(KIT_STORE, { ...loadStored<object>(KIT_STORE, {}), tab: tool });
    window.dispatchEvent(new CustomEvent(KIT_TAB_EVENT));
  }
  (await import('../../tools')).openTool('kitelectrical');
}
