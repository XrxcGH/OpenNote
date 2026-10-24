// "Update" for an exported PDF: this session remembers where each page's PDF went, and Update writes there again
// without asking. The shell moves the old file to the Recycle Bin first (or keeps a copy beside it), and the notice
// offers Undo. A path is only remembered for this session, because the shell only replaces files it wrote itself.
import type { ExportsClient, ReplaceReceipt } from '../../../platform/types';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';

const lastPdf = new Map<string, string>();

/** Remembers where a page's PDF went. */
export function rememberExport(pageId: string, path: string): void {
  lastPdf.set(pageId, path);
}

/** Where this session last exported the page's PDF, or null. */
export function lastExportPath(pageId: string): string | null {
  return lastPdf.get(pageId) ?? null;
}

const fileName = (path: string) => path.split(/[\x5c/]/).pop() ?? path;

/** The "Replaced, Undo" notice. Undo puts the old file back and removes the new one. */
export function showReplaced(client: ExportsClient, path: string, receipt: ReplaceReceipt): void {
  const name = fileName(path);
  const message =
    receipt.kept === 'beside'
      ? t('pageViews.print.replacedBeside', { name, kept: receipt.keptAs ?? '' })
      : t('pageViews.print.replaced', { name });
  // With nothing replaced (the file was gone), there is nothing to undo.
  if (receipt.kept === 'nothing') return void showToast({ message });
  showToast({
    message,
    action: {
      label: t('pageViews.print.undo'),
      run: () =>
        client.undoReplace(path).then(
          () => void showToast({ message: t('pageViews.print.restored', { name }) }),
          () => void showToast({ message: t('pageViews.print.undoFailed'), tone: 'danger' }),
        ),
    },
  });
}
