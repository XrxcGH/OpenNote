// Opens the aerospace window, on a tool if one is named. The choice is saved first, and a window that is already
// open hears the event and switches tabs.
import { openTool } from '../../tools';
import type { AeroToolId } from './meta';
import { AERO_TAB_EVENT, loadKit, saveKit } from './store';

export function openAeroKit(tool?: AeroToolId): void {
  if (tool) {
    saveKit({ ...loadKit(), tab: tool });
    window.dispatchEvent(new CustomEvent(AERO_TAB_EVENT));
  }
  openTool('kitaero');
}
