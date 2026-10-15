// The interop feature's public face for other features: what an export covers, and the tree the host needs for it, and
// opening Import notes on a file that is already on this PC.
import { lazy } from 'react';
import { commandContext } from '../../commands/registry';
import { showOverlay } from '../../shell/commandbar/overlays';

export { collectRequest, pageCount, resolveTarget } from './exportTarget';
export type { ExportChoice, ExportTarget } from './exportTarget';

const LazyImport = lazy(() => import('./ImportDialog'));

/** Opens Import notes on a file that is already on this PC, at the review step. Nothing is added until Import. */
export function importFile(path: string): void {
  const context = commandContext('palette');
  showOverlay('interop-import', LazyImport, {
    interop: context.platform.interop,
    notes: context.notes,
    initialPath: path,
  });
}
