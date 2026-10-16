// What the elements commands do once they load: open the library, and save the picked items as an element.
import type { CommandContext } from '../../../commands/types';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { saveAsElement } from '../host/elementActions';
import { loadElementLibrary } from '../host/elementStore';
import { hasChosen } from '../host/chosen';
import { collectSource } from '../host/source';
import { ElementsDialog, SaveElementDialog } from './ElementsDialog';
import { openDialog } from './openDialog';

/** Opens the elements library. */
export async function openElementsLibrary(ctx: CommandContext): Promise<void> {
  await loadElementLibrary();
  await openDialog((close) => <ElementsDialog platform={ctx.platform} close={close} />);
}

/** Asks for a name and folder, and keeps the picked blocks and strokes as an element. */
export async function saveSelectionAsElement(ctx: CommandContext): Promise<void> {
  if (!hasChosen()) {
    showToast({ message: t('pagesPlus.elements.save.nothing') });
    return;
  }
  const source = await collectSource(ctx.notes);
  if (!source) {
    showToast({ message: t('pageViews.files.nothing') });
    return;
  }
  await loadElementLibrary();
  await openDialog((close) => (
    <SaveElementDialog
      defaultName={source.title}
      close={close}
      save={async (name, folder) => {
        const outcome = await saveAsElement(source, name, folder);
        if (!outcome.ok) return t(`pagesPlus.elements.errors.${outcome.error}`);
        const skipped =
          outcome.skipped > 0 ? ` ${t('pagesPlus.elements.save.skipped', { count: outcome.skipped })}` : '';
        showToast({ message: t('pagesPlus.elements.save.saved', { name }) + skipped });
        if (!outcome.saved) showToast({ message: t('pagesPlus.elements.errors.notSaved'), tone: 'danger' });
        return null;
      }}
    />
  ));
}
