// What the Page gallery command does once it loads.
import { getLocation } from '../../../app/location';
import type { CommandContext } from '../../../commands/types';
import { Gallery } from './Gallery';
import { openDialog } from './openDialog';

/** Opens the gallery of the section that is open. */
export async function openGallery(ctx: CommandContext): Promise<void> {
  const where = getLocation();
  const [notebookId, sectionId] = where.view === 'workspace' ? [where.notebookId, where.sectionId] : [null, null];
  await openDialog((close) => (
    <Gallery
      notes={ctx.notes}
      platform={ctx.platform}
      notebookId={notebookId}
      sectionId={sectionId}
      navigate={(to) => ctx.navigate(to)}
      close={close}
    />
  ));
}
