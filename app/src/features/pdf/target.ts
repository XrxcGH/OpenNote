// Where the PDF tools send their edits. The shown page takes them through its sync queue, and the view shows them at
// once, as the image commands do; a page that isn't shown is opened, changed, and closed. Either way the edits of one
// command go in one batch, so one undo takes them back.
import { applyMergePatch } from '../../platform/mergePatch';
import type { BlockJson, Edit, ImageSource, ImportedAsset, OpenPage } from '../../services/pages/types';
import type { MountedPage } from '../page';

export interface EditTarget {
  readonly page: OpenPage;
  /** The page's blocks as they are now. */
  blocks(): readonly BlockJson[];
  importImage(source: ImageSource): Promise<ImportedAsset>;
  send(edits: readonly Edit[]): Promise<void>;
}

/** A page that isn't shown. */
export function closedTarget(page: OpenPage): EditTarget {
  let blocks = page.initial.blocks;
  return {
    page,
    blocks: () => blocks,
    importImage: (source) => page.importImage(source),
    async send(edits) {
      await page.send({ edits: [...edits] });
      blocks = applyLocally(blocks, edits, {});
    },
  };
}

/** The shown page: edits go through its queue, and the view shows the result without waiting for a reload. */
export async function shownTarget(mounted: MountedPage): Promise<EditTarget> {
  const { assetTable } = await import('../page');
  const table = assetTable(mounted.page);
  return {
    page: mounted.page,
    blocks: () => mounted.layer.blocks(),
    async importImage(source) {
      const asset = await mounted.page.importImage(source);
      table.add(asset.id, asset.asset);
      return asset;
    },
    async send(edits) {
      const ack = await mounted.sync.send({ edits: [...edits] });
      const touched = new Set(edits.flatMap(touchedBy));
      for (const block of applyLocally(mounted.layer.blocks(), edits, ack.orderKeys)) {
        if (touched.has(block.id)) mounted.layer.upsert(block);
      }
    },
  };
}

function touchedBy(edit: Edit): string[] {
  if (edit.edit === 'insertBlock') return [edit.block.id];
  if (edit.edit === 'moveBlock' || edit.edit === 'patchBlock') return [edit.block];
  return [];
}

/** The blocks after the edits, as the service applies them: inserts, moves, patches, and deletes. */
export function applyLocally(
  blocks: readonly BlockJson[],
  edits: readonly Edit[],
  orderKeys: Readonly<Record<string, string>>,
): BlockJson[] {
  const now = new Date().toISOString();
  const byId = new Map(blocks.map((block) => [block.id, block]));
  for (const edit of edits) {
    if (edit.edit === 'insertBlock') {
      byId.set(edit.block.id, { ...edit.block, order: orderKeys[edit.block.id] ?? 'zz', created: now, modified: now });
    } else if (edit.edit === 'moveBlock') {
      const block = byId.get(edit.block);
      if (!block) continue;
      const { frame: _old, ...rest } = block;
      byId.set(
        edit.block,
        edit.frame ? { ...rest, frame: { ...edit.frame }, modified: now } : { ...rest, modified: now },
      );
    } else if (edit.edit === 'patchBlock') {
      const block = byId.get(edit.block);
      if (!block) continue;
      const next: BlockJson = { ...block, modified: now };
      if (edit.data) next.data = applyMergePatch(block.data, edit.data);
      if (edit.lock === null) delete next.lock;
      else if (edit.lock) next.lock = edit.lock;
      byId.set(edit.block, next);
    } else if (edit.edit === 'deleteBlocks') {
      for (const id of edit.blocks) byId.delete(id);
    }
  }
  return [...byId.values()];
}
