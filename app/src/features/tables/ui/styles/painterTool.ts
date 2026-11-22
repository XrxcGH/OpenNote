// The format painter tool. Running it copies the format of the selected cell and waits: the next cells the person
// selects with the pointer (or Enter, with the keyboard) get that format as one change, and then it turns off.
// Escape, or running the command again, turns it off without painting.
import { t } from '../../../../strings/t';
import type { TableExtraHost } from '../../../page';
import { boxOfSelection } from '../../sheet/formatTarget';
import { readSheet } from '../../sheet/model';
import { paint } from './painter';

/** How long after the pointer is released the editor has to finish setting its selection. */
const SETTLE_MS = 40;

const armed = new Map<string, () => void>();

/** True while the painter waits on this block's table. */
export const isPainting = (block: string): boolean => armed.has(block);

/** Turns the painter on for the table of `host`, or off when it is on. */
export function togglePainter(host: TableExtraHost): void {
  const off = armed.get(host.block);
  if (off) {
    off();
    host.announce(t('sheetFormat.painter.cancelled'));
    return;
  }
  const table = host.table();
  const from = boxOfSelection(host.editor.state, table);
  if (!from) {
    host.announce(t('sheetFormat.painter.nothing'));
    return;
  }
  const source = { row: from.top, col: from.left };
  const dom = host.editor.view.dom;
  const stop = () => {
    document.removeEventListener('pointerup', onPointer, true);
    dom.removeEventListener('keydown', onKey, true);
    armed.delete(host.block);
  };
  const run = () => {
    const target = boxOfSelection(host.editor.state, host.table());
    stop();
    if (!target) return;
    const done = paint(readSheet(host.data()), host.table(), source, target);
    if (!done.patch) return host.announce(t('sheetFormat.painter.nothing'));
    void host.patch(done.patch).then(() => host.announce(t('sheetFormat.painter.done')));
  };
  // The editor sets its selection around the release of the button; paint a moment after it.
  function onPointer(event: PointerEvent) {
    if (event.target instanceof Node && dom.contains(event.target)) setTimeout(run, SETTLE_MS);
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      stop();
      host.announce(t('sheetFormat.painter.cancelled'));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run();
    }
  }
  armed.set(host.block, stop);
  document.addEventListener('pointerup', onPointer, true);
  dom.addEventListener('keydown', onKey, true);
  host.announce(t('sheetFormat.painter.armed'));
}
