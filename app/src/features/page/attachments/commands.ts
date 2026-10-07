// What the attachment commands do; they load when a command first runs.
import { fileView } from '../blocks/fileBlock';
import { shownMounted } from '../pagesApi';
import { attachFiles, pickFiles, selectedFileId } from './attach';
import { saveSelectedCopy } from './saveCopy';

/** Attach file: the Windows open dialog, then the files after the block with the caret. */
export async function attachFile(): Promise<void> {
  const mounted = shownMounted.get();
  if (mounted && !mounted.page.readOnly) await pickFiles(mounted);
}

function selectedView() {
  const mounted = shownMounted.get();
  const id = mounted ? selectedFileId(mounted) : null;
  return mounted && id ? fileView(mounted.layer.view(id)) : null;
}

export async function openSelected(): Promise<void> {
  await selectedView()?.open();
}

/** Switches the selected attachment between the icon and the preview. */
export function toggleDisplay(): void {
  const view = selectedView();
  view?.setDisplay(view.display() === 'icon' ? 'preview' : 'icon');
}

/** Save a copy: the selected attachment, through the Save dialog. */
export async function saveCopy(): Promise<void> {
  const mounted = shownMounted.get();
  if (mounted) await saveSelectedCopy(mounted);
}

export { attachFiles };
