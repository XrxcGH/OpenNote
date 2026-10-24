// Opens the molecular biology window, on a tool if one is named.
import { openTool } from '../ui/host';
import { loadStored, saveStored } from '../ui/storage';
import { KIT_STORE, KIT_TAB_EVENT } from './events';
import type { MolToolId } from './meta';

export function openMolBio(tool?: MolToolId): void {
  if (tool) {
    saveStored(KIT_STORE, { ...loadStored<object>(KIT_STORE, {}), tab: tool });
    window.dispatchEvent(new CustomEvent(KIT_TAB_EVENT));
  }
  openTool('kitmolbio');
}
