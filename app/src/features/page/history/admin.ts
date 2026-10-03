// Deleting history (ARCHITECTURE.md section 21) goes through history_delete, which needs the notebook a page is in.
// The shell installs both once the core's notebook commands are wired; until then the panel offers no delete.
import type { HistoryAdmin, PageId } from '../../../services/pages/types';

export interface HistoryAdminSeam extends HistoryAdmin {
  /** The notebook that holds a page, or null when it isn't known. */
  notebookOf(page: PageId): string | null;
}

let installed: HistoryAdminSeam | null = null;

export function installHistoryAdmin(admin: HistoryAdminSeam | null): () => void {
  installed = admin;
  return () => {
    if (installed === admin) installed = null;
  };
}

export function historyAdmin(): HistoryAdminSeam | null {
  return installed;
}
