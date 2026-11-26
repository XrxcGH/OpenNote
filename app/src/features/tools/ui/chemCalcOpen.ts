// Opens the chemistry calculators on one tab, as a live calculation block's Open in tool does. The tab is saved with
// the window's other choices, and a window that is already open hears the event and follows it.
import { openTool } from './host';
import { loadStored, saveStored } from './storage';

export const CHEMCALC_STORE = 'chemcalc';
export const CHEMCALC_TAB_EVENT = 'opennote:chemcalc-tab';

export function openChemCalc(tab?: string): void {
  if (tab) {
    saveStored(CHEMCALC_STORE, { ...loadStored<object>(CHEMCALC_STORE, {}), tab });
    window.dispatchEvent(new CustomEvent(CHEMCALC_TAB_EVENT));
  }
  openTool('chemcalc');
}
