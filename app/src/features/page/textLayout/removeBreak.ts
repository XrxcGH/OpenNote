// Backspace at the start of the text after a break removes the break and keeps the caret where it was (spec 6.12).
import type { RemoveBreakDetail } from '../../../editor/commands/state';
import { shownLayer } from '../mount';
import { shownPool } from '../pool/shown';
import { shownQueue } from '../sync';
import { announce } from '../../../ui';
import { t } from '../../../strings/t';

/** Deletes the break block. Returns false when no page is shown or the core refuses. */
export async function removeBreak({ breakBlock, block }: RemoveBreakDetail): Promise<boolean> {
  const queue = shownQueue.get();
  const layer = shownLayer.get();
  if (!queue || !layer || !layer.block(breakBlock)) return false;
  try {
    await queue.send({ edits: [{ edit: 'deleteBlocks', blocks: [breakBlock] }] });
  } catch {
    announce(t('textLayout.announce.breakFailed'));
    return false;
  }
  layer.remove(breakBlock);
  shownPool.get()?.editor(block)?.commands.focus('start');
  announce(t('textLayout.announce.breakRemoved'));
  return true;
}
