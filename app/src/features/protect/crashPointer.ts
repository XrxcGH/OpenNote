// After a crash, the next start points once, calmly, to Check notebook for the notebook that is open (A2-2).

import { isEnabled } from '../../app/flags';
import { commandContext } from '../../commands/registry';
import type { NodeId } from '../../services/notes';
import { t } from '../../strings/t';
import { showToast } from '../../ui';
import { loadCheckNotebook } from '../qol';

/**
 * Shows the note that points to Check notebook when the last session crashed and a notebook is open. Returns
 * whether it showed.
 */
export function pointToCheck(previous: string, notebookId: NodeId | null): boolean {
  if (previous !== 'crashed' || !notebookId || !isEnabled('qol.checkNotebook')) return false;
  showToast({
    id: 'check-after-crash',
    message: t('storage.check.afterCrash'),
    action: {
      label: t('storage.check.afterCrashAction'),
      run: async () => {
        const book = await commandContext('menu').notes.get(notebookId);
        if (book) await (await loadCheckNotebook()).openNotebookCheck(book);
      },
    },
  });
  return true;
}
