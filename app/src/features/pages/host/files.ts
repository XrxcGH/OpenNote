// Files the pages area reads and writes beside the page: a text file the person picks, and bytes saved through the Save
// dialog. Both go through the browser's file input and the shell's export commands, so they work the same everywhere.
import type { Platform } from '../../../platform/types';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';

/** Asks for a text file, such as a template or an element, and reads it. Resolves to null when none is chosen. */
export function pickTextFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) file.text().then(resolve, () => resolve(null));
      else resolve(null);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export interface SaveRequest {
  /** The file name the Save dialog starts with, extension included. */
  readonly suggested: string;
  /** The type's name in the dialog, such as "Layout template". */
  readonly label: string;
  /** The extension without its dot. */
  readonly extension: string;
  readonly bytes: Uint8Array;
}

/** Shows the Save dialog and writes the bytes. Answers the path, or null when the person cancels. */
export async function saveFile(platform: Platform, request: SaveRequest): Promise<string | null> {
  const { suggested, label, extension, bytes } = request;
  const path = await platform.exports.pickSave({ suggested, label, extension });
  if (path === null) return null;
  await platform.exports.write(path, [{ path: '', bytes }]);
  showToast({
    message: t('pageViews.files.saved', { name: path.split(/[\\/]/).pop() ?? suggested }),
    action: { label: t('pageViews.print.openFile'), run: () => platform.exports.open(path, true) },
  });
  return path;
}

/** A file name with the characters Windows refuses taken out. */
export function fileSafe(name: string, fallback: string): string {
  const spaced = Array.from(name, (ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? ' ' : ch)).join('');
  return spaced.replace(/\s+/g, ' ').trim().slice(0, 80) || fallback;
}
