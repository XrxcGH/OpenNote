// Opens the Chemistry and materials window on one of its tools. The tab is saved first, so a window that is already
// open (or about to open) reads it, and an event wakes an open window.
import { saveStored } from '../ui/storage';

export const TAB_STORE = 'chemmat.tab';
export const CHEMMAT_TAB_EVENT = 'opennote:chemmat-tab';
export const CHEMMAT_WINDOW = 'kit-chemmat' as const;

export async function openChemMatTool(id: string): Promise<void> {
  saveStored(TAB_STORE, id);
  window.dispatchEvent(new CustomEvent(CHEMMAT_TAB_EVENT));
  await (await import('../index')).openTool(CHEMMAT_WINDOW);
}
