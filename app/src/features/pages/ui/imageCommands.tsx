// What the Export as picture command does once it loads.
import type { CommandContext } from '../../../commands/types';
import { pageSelection } from '../../page';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { makePicture, rememberedSelectMode, selectionFor, svgToPng } from '../host/picture';
import { collectSource } from '../host/source';
import { ImageDialog } from './ImageDialog';
import type { Format } from './ImageDialog';
import { openDialog } from './openDialog';

/** Opens the picture dialog for what the lasso picked on the shown page, or the whole page. */
export async function exportImage(ctx: CommandContext, formats?: readonly Format[]): Promise<void> {
  const source = await collectSource(ctx.notes);
  if (!source) {
    showToast({ message: t('pageViews.files.nothing') });
    return;
  }
  const chosen = pageSelection.get();
  await openDialog((close) => (
    <ImageDialog source={source} platform={ctx.platform} chosen={chosen} formats={formats} close={close} />
  ));
}

/** Puts the lasso's picture, or the whole page's, on the clipboard as a PNG. */
export async function copyImage(ctx: CommandContext): Promise<void> {
  const source = await collectSource(ctx.notes);
  if (!source) {
    showToast({ message: t('pageViews.files.nothing') });
    return;
  }
  const chosen = pageSelection.get();
  const scope = chosen.blocks.length + chosen.strokes.length > 0 ? 'selection' : 'page';
  const selection = selectionFor(source, scope, chosen, rememberedSelectMode());
  if (!selection) {
    showToast({ message: t('pageViews.image.nothingSelected') });
    return;
  }
  try {
    const picture = await makePicture(source, selection, source.title || t('pageViews.print.untitled'));
    const blob = await svgToPng(picture, 2);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showToast({ message: t('pageViews.image.copied') });
  } catch (error) {
    ctx.platform.log('error', `Copy as image failed: ${String(error)}`);
    showToast({
      message: t(error instanceof RangeError ? 'pageViews.image.tooLarge' : 'pageViews.image.failed'),
      tone: 'danger',
    });
  }
}
