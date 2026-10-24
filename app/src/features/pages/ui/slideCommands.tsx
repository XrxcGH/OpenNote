// What the Present as slides command does once it loads.
import type { CommandContext } from '../../../commands/types';
import { shownMounted } from '../../page';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { collectSource } from '../host/source';
import { openDialog } from './openDialog';
import { SlidePlayer } from './SlidePlayer';

/** Shows the shown page as slides, starting at the slide of the block the caret is in. */
export async function presentPage(ctx: CommandContext): Promise<void> {
  const source = await collectSource(ctx.notes);
  if (!source) {
    showToast({ message: t('pageViews.files.nothing') });
    return;
  }
  const start = shownMounted.get()?.pool.active()?.block ?? null;
  await openDialog((close) => <SlidePlayer source={source} startBlock={start} close={close} />);
}
