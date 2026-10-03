// Attaching files to a page: from the file picker, from a drop, and from a paste. Each file's bytes go to the shell,
// which stores them as an asset of the page; then one step adds the assets and their blocks, so one Ctrl+Z removes
// them all. Files over 200 MB are refused. Opening and saving back are in blocks/fileBlock.ts and saveBack.ts.
import { commandContext } from '../../../commands/registry';
import { newId } from '../../../editor/ids';
import type { PageExtrasClient } from '../../../platform/types';
import type { BlockId, Edit, ImportedAsset, NewBlock } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { assetTable } from '../images/assets';
import { defaultPlacement, showInserted } from '../images/insert';
import type { Placement } from '../images/insert';
import type { MountedPage } from '../mount';
import { pageSelection, selectOnPage } from '../seams/selectionStore';

export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024;

const KEEP_BELOW = 24;

function native(): PageExtrasClient | null {
  try {
    return commandContext('menu').platform.pageExtras;
  } catch {
    return null;
  }
}

/** The edits that add attached assets as blocks: after `place.block` in flow, stacked from a point otherwise. */
export function attachmentEdits(
  assets: readonly ImportedAsset[],
  place: Placement,
  display: 'icon' | 'preview' = 'icon',
): { edits: Edit[]; blocks: BlockId[] } {
  const edits: Edit[] = [];
  const blocks: BlockId[] = [];
  let after = place.kind === 'after' ? place.block : null;
  let y = place.kind === 'point' ? place.y : 0;
  for (const asset of assets) {
    const id = newId();
    const block: NewBlock = {
      id,
      type: 'file',
      ...(place.kind === 'point' ? { frame: { x: place.x, y } } : {}),
      data: { asset: asset.id, ...(display === 'preview' ? { display } : {}) },
    };
    edits.push({ edit: 'addAsset', asset: asset.id });
    edits.push(after ? { edit: 'insertBlock', block, after } : { edit: 'insertBlock', block });
    blocks.push(id);
    if (place.kind === 'after') after = id;
    y += 72 + KEEP_BELOW;
  }
  return { edits, blocks };
}

/** Attaches files to the page. Resolves the new blocks' IDs. */
export async function attachFiles(
  mounted: MountedPage,
  files: readonly File[],
  place: Placement = defaultPlacement(mounted),
): Promise<BlockId[]> {
  const client = native();
  if (!client || mounted.page.readOnly || files.length === 0) return [];
  const imported: ImportedAsset[] = [];
  let failed = 0;
  let tooLarge = 0;
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      tooLarge += 1;
      continue;
    }
    try {
      imported.push(await client.attachBytes(mounted.page.id, await file.arrayBuffer(), file.name, file.type));
    } catch {
      failed += 1;
    }
  }
  if (tooLarge > 0) showToast({ message: t('pageExtras.attach.tooLarge', { count: tooLarge }), tone: 'danger' });
  if (failed > 0) showToast({ message: t('pageExtras.attach.failed', { count: failed }), tone: 'danger' });
  if (imported.length === 0) return [];
  const table = assetTable(mounted.page);
  imported.forEach((asset) => table.add(asset.id, asset.asset));
  const { edits, blocks } = attachmentEdits(imported, place);
  const ack = await mounted.sync.send({ edits });
  showInserted(mounted, edits, ack.orderKeys);
  selectOnPage({ blocks: blocks.slice(0, 1), strokes: [] });
  mounted.layer.view(blocks[0])?.element.focus({ preventScroll: false });
  announce(t('pageExtras.attach.added', { count: blocks.length }));
  return blocks;
}

/** The Windows open dialog for any kind of file. */
export function pickFiles(mounted: MountedPage): Promise<BlockId[]> {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  return new Promise((resolve) => {
    input.addEventListener('change', () => void attachFiles(mounted, [...(input.files ?? [])]).then(resolve), {
      once: true,
    });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

/** The one selected file block, if exactly that is selected. */
export function selectedFileId(mounted: MountedPage): BlockId | null {
  const { blocks, strokes } = pageSelection.get();
  if (blocks.length !== 1 || strokes.length > 0) return null;
  return mounted.layer.block(blocks[0])?.type === 'file' ? blocks[0] : null;
}
