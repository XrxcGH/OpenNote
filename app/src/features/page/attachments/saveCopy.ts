// "Save a copy" for an attachment: the file goes to a place the person picks in Windows' Save dialog, as it was
// attached. The page keeps its own copy, so nothing changes in the note.
import { commandContext } from '../../../commands/registry';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { assetTable } from '../images/assets';
import type { MountedPage } from '../mount';
import { extensionOf } from './model';
import { selectedFileId } from './attach';

/** The extension for the Save dialog: the file's own when it has a plain one, otherwise "bin". */
export function copyExtension(name: string): string {
  const extension = extensionOf(name);
  return extension !== '' && extension.length <= 12 && /^[a-z0-9]+$/.test(extension) ? extension : 'bin';
}

/** Saves the attached file in block `block`. Resolves the path, or null when the person cancels or it fails. */
export async function saveAttachmentCopy(mounted: MountedPage, block: string): Promise<string | null> {
  const id = mounted.layer.block(block)?.data.asset;
  const asset = typeof id === 'string' ? assetTable(mounted.page).get(id) : null;
  if (typeof id !== 'string' || !asset) {
    showToast({ message: t('pageExtras.attach.copyFailed'), tone: 'danger' });
    return null;
  }
  try {
    const exports = commandContext('menu').platform.exports;
    const path = await exports.pickSave({
      suggested: asset.name,
      label: t('pageExtras.attach.copyLabel'),
      extension: copyExtension(asset.name),
    });
    if (path === null) return null;
    const response = await fetch(mounted.page.assetUrl(id));
    if (!response.ok) throw new Error(String(response.status));
    await exports.write(path, [{ path: '', bytes: new Uint8Array(await response.arrayBuffer()) }]);
    const name = path.split(/[\/]/).pop() ?? asset.name;
    announce(t('pageExtras.attach.copySaved', { name }));
    showToast({
      message: t('pageExtras.attach.copySaved', { name }),
      action: { label: t('pageExtras.attach.showCopy'), run: () => exports.open(path, true) },
    });
    return path;
  } catch {
    showToast({ message: t('pageExtras.attach.copyFailed'), tone: 'danger' });
    return null;
  }
}

/** The command: saves a copy of the selected attachment. */
export async function saveSelectedCopy(mounted: MountedPage): Promise<void> {
  const block = selectedFileId(mounted);
  if (block) await saveAttachmentCopy(mounted, block);
}
