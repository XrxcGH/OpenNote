// Opens the circuits and energy window, on a tool if one is named.
import { loadStored, openTool, saveStored } from '../../tools';
import { KIT_STORE, KIT_TAB_EVENT } from './events';
import type { ElectricalToolId } from './meta';

export function openKit(tool?: ElectricalToolId): void {
  if (tool) {
    saveStored(KIT_STORE, { ...loadStored<object>(KIT_STORE, {}), tab: tool });
    window.dispatchEvent(new CustomEvent(KIT_TAB_EVENT));
  }
  openTool('kitelectrical');
}
