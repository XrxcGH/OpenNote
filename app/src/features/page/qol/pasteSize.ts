// Screenshot paste size: a pasted screenshot or image comes in at its actual
// size on this display, fits the column, or asks. "Actual size" counts the display's scaling, so a screenshot taken
// at 150% looks as it did on screen. Any image can switch size afterwards from its toolbar.
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { assetTable } from '../images/assets';
import { cropOf, initialSize } from '../images/geometry';
import type { BlockId, Frame } from '../../../services/pages/types';
import type { MountedPage } from '../mount';
import { pageExtrasPrefs } from './prefs';
import type { PasteSize } from './prefs';

export type Sizing = 'actual' | 'fit';

/** The size choice for a paste. With the feature off, images fit the column as they always did. */
export function pasteSizeChoice(mounted: Pick<MountedPage, 'host'>): PasteSize {
  return mounted.host.flag('page.pasteSize') ? pageExtrasPrefs.get().pasteSize : 'fit';
}

/** The sizing an insert uses for a choice: asking inserts at the column's width and offers the other size. */
export const sizingFor = (choice: PasteSize): Sizing => (choice === 'actual' ? 'actual' : 'fit');

/** The size of an image at its own pixels on a display with this scaling, at most `maxWidth` wide. */
export function sizeFor(
  pixels: { width: number; height: number },
  options: { dpr: number; maxWidth: number; sizing: Sizing },
): { w: number; h: number } {
  const maxWidth = options.sizing === 'actual' ? Number.POSITIVE_INFINITY : options.maxWidth;
  return initialSize(pixels, { dpr: options.dpr, maxWidth });
}

/** Sets the pasted images to their actual size, as one step. */
export async function applyActualSize(mounted: MountedPage, blocks: readonly BlockId[]): Promise<void> {
  const table = assetTable(mounted.page);
  const dpr = window.devicePixelRatio || 1;
  const edits = blocks.flatMap((id) => {
    const block = mounted.layer.block(id);
    const asset = typeof block?.data.asset === 'string' ? table.get(block.data.asset) : null;
    if (!block || !asset?.width || !asset.height) return [];
    const crop = cropOf(block.data);
    const size = initialSize(
      { width: asset.width * (crop?.w ?? 1), height: asset.height * (crop?.h ?? 1) },
      { dpr, maxWidth: Number.POSITIVE_INFINITY },
    );
    const floating = block.frame?.x !== undefined && block.frame?.y !== undefined;
    const frame: Frame = floating ? { ...block.frame, w: size.w, h: size.h } : { w: size.w };
    return [{ edit: 'moveBlock' as const, block: id, frame }];
  });
  if (edits.length === 0) return;
  const ack = await mounted.sync.send({ edits }).catch(() => null);
  if (!ack) return;
  for (const edit of edits) {
    const block = mounted.layer.block(edit.block);
    if (block) mounted.layer.upsert({ ...block, frame: edit.frame as Frame });
  }
}

/** After a paste that asked: says the image fit the column, and offers its actual size. */
export function offerActualSize(mounted: MountedPage, blocks: readonly BlockId[]): void {
  if (blocks.length === 0) return;
  showToast({
    id: 'page.pasteSize',
    message: t('pageExtras.pasteSize.askMessage'),
    action: { label: t('pageExtras.pasteSize.useActual'), run: () => applyActualSize(mounted, blocks) },
  });
}
