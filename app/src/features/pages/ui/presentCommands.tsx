// What the Present page command does once it loads: the whole page full screen, with a laser pointer and fading ink.
import type { CommandContext } from '../../../commands/types';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { makePicture, selectionFor } from '../host/picture';
import { collectSource } from '../host/source';
import { openDialog } from './openDialog';
import { PresentPage } from './PresentPage';

/** Shows the shown page, whole, on a full-screen stage. */
export async function presentWholePage(ctx: CommandContext): Promise<void> {
  const source = await collectSource(ctx.notes);
  const selection = source ? selectionFor(source, 'page', { blocks: [], strokes: [] }) : null;
  if (!source || !selection) {
    showToast({ message: t('pagesPlus.present.empty') });
    return;
  }
  try {
    const picture = await makePicture(source, selection, source.title || t('pageViews.print.untitled'));
    await openDialog((close) => <PresentPage picture={picture} close={close} />);
  } catch (error) {
    ctx.platform.log('error', `Present page failed: ${String(error)}`);
    showToast({ message: t('pageViews.image.failed'), tone: 'danger' });
  }
}
