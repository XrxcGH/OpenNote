// Inserting a panel block after the block with the caret (or at the end of an empty page). The block needs a
// fallback, because its type is newer than version 1 of the page format: a reader that doesn't know the type shows
// the text, and search finds it.
import { newId } from '../../../editor/ids';
import type { BlockId, BlockJson, Edit, Frame, NewBlock } from '../../../services/pages/types';
import type { PanelType } from './kinds';
import { PageServiceError } from '../../../services/pages/types';
import { shownLayer } from '../mount';
import { shownPool } from '../pool/shown';
import { shownQueue } from '../sync/shown';

/** Adds the block and returns its ID, or null when no page is shown. */
export async function insertPanelBlock(
  type: PanelType,
  data: Record<string, unknown>,
  fallback: string,
  frame?: Frame,
): Promise<BlockId | null> {
  const queue = shownQueue.get();
  const layer = shownLayer.get();
  if (!queue || !layer) return null;
  const id = newId();
  const after = shownPool.get()?.active()?.block;
  const block: NewBlock = { id, type, data, fallback: { markdown: fallback }, ...(frame ? { frame } : {}) };
  const place = (anchor: BlockId | undefined): Edit[] => [
    { edit: 'insertBlock', block, ...(anchor ? { after: anchor } : {}) },
  ];
  let ack;
  try {
    ack = await queue.send({ edits: place(after) });
  } catch (error) {
    // The block with the caret may not exist in the core yet (a page just started): the new block goes last instead.
    if (!after || !(error instanceof PageServiceError) || error.code !== 'notFound') throw error;
    ack = await queue.send({ edits: place(undefined) });
  }
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
