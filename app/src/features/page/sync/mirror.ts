// What the sync knows of the page's blocks (owner: WP2): each block's type, frame, and order key, as the core has
// them, from the page as opened plus every batch the core took and every frame it sent. Undo announcements read it
// to say what a step changed, and the text sync reads it to tell a floating text box from a flowing one.
import type { AppliedFrame, BlockId, EditBatch, Frame, PageJson, TxnAck } from '../../../services/pages/types';

export interface MirroredBlock {
  type: string;
  frame?: Frame;
  order: string;
}

export interface Mirror {
  get(block: BlockId): MirroredBlock | undefined;
  /** Whether the block sits at its own place on the page rather than in the flow. */
  floating(block: BlockId): boolean;
  sent(batch: EditBatch, ack: TxnAck): void;
  applied(frame: AppliedFrame): void;
}

export function createMirror(page: PageJson): Mirror {
  const blocks = new Map<BlockId, MirroredBlock>();
  for (const block of page.blocks) blocks.set(block.id, { type: block.type, frame: block.frame, order: block.order });
  return {
    get: (block) => blocks.get(block),
    floating(block) {
      const frame = blocks.get(block)?.frame;
      return frame?.x !== undefined && frame.y !== undefined;
    },
    sent(batch, ack) {
      for (const edit of batch.edits) {
        if (edit.edit === 'insertBlock') {
          const { id, type, frame } = edit.block;
          blocks.set(id, { type, frame, order: ack.orderKeys[id] ?? '' });
        } else if (edit.edit === 'moveBlock') {
          const found = blocks.get(edit.block);
          if (!found) continue;
          if (edit.frame === null) delete found.frame;
          else if (edit.frame) found.frame = { ...found.frame, ...edit.frame };
          found.order = ack.orderKeys[edit.block] ?? found.order;
        } else if (edit.edit === 'deleteBlocks') {
          edit.blocks.forEach((id) => blocks.delete(id));
        }
      }
    },
    applied(frame) {
      for (const block of frame.blocks)
        blocks.set(block.id, { type: block.type, frame: block.frame, order: block.order });
      frame.removed.forEach((id) => blocks.delete(id));
    },
  };
}
