// What the Export as picture command does once it loads.
import type { CommandContext } from '../../../commands/types';
import { pageSelection } from '../../page';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { collectSource } from '../host/source';
import { ImageDialog } from './ImageDialog';
import { openDialog } from './openDialog';

/** Opens the picture dialog for the selected blocks of the shown page, or the whole page. */
export async function exportImage(ctx: CommandContext): Promise<void> {
  const source = await collectSource(ctx.notes);
  if (!source) {
    showToast({ message: t('pageViews.files.nothing') });
    return;
  }
  const chosen = pageSelection.get().blocks;
  await openDialog((close) => <ImageDialog source={source} platform={ctx.platform} chosen={chosen} close={close} />);
}
