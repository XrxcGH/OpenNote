// Inserting a panel block after the block with the caret (or at the end of an empty page). The block needs a
// fallback, because its type is newer than version 1 of the page format: a reader that doesn't know the type shows
// the text, and search finds it.
import { newId } from '../../../editor/ids';
import type { BlockId, BlockJson, Edit, Frame, NewBlock } from '../../../services/pages/types';
import { shownLayer } from '../mount';
import { shownPool } from '../pool/shown';
import { shownQueue } from '../sync/shown';

/** Adds the block and returns its ID, or null when no page is shown. */
export async function insertPanelBlock(
  type: string,
  data: Record<string, unknown>,
  fallback: string,
  frame?: Frame,
): Promise<BlockId | null> {
  const queue = shownQueue.get();
  const layer = shownLayer.get();
  if (!queue || !layer) return null;
  const id = newId();
  const after = shownPool.get()?.active()?.block;
  const block = { id, type, data, fallback: { markdown: fallback }, ...(frame ? { frame } : {}) } as NewBlock;
  const edits: Edit[] = [{ edit: 'insertBlock', block, ...(after ? { after } : {}) }];
  const ack = await queue.send({ edits });
  const now = new Date().toISOString();
  const made: BlockJson = {
    id,
    type,
    order: ack.orderKeys[id] ?? 'zz',
    created: now,
    modified: now,
    data,
    fallback: { markdown: fallback },
    ...(frame ? { frame } : {}),
  };
  layer.upsert(made);
  return id;
}
