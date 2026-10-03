// Saving a file from the study tools (a deck as CSV or an Anki package, a bibliography). In the app the Save
// dialog picks the place and the shell writes the file; in a browser the browser's own save flow names it.
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { deckToCsv } from '../deck/exchange';
import type { Deck } from '../deck/types';

const BAD_CHARS = '\\/:*?"<>|';

/** A file name made from a title. */
export function fileName(title: string, extension: string): string {
  const cleaned = [...title].map((char) => (char.charCodeAt(0) < 32 || BAD_CHARS.includes(char) ? ' ' : char));
  return `${cleaned.join('').trim().slice(0, 80) || 'file'}.${extension}`;
}

/** Offers the bytes to the person as a download. */
function downloadBytes(name: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Saves the bytes under the name. Returns false when the person cancels the Save dialog. The file goes through the
 * shell's export commands, so it can only be written where the person chose.
 */
export async function saveBytes(name: string, label: string, bytes: Uint8Array, type: string): Promise<boolean> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    downloadBytes(name, bytes, type);
    return true;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const extension = name.slice(name.lastIndexOf('.') + 1);
  const path = await invoke<string | null>('export_pick_save', { suggested: name, label, extension });
  if (path === null) return false;
  const parts = [{ path: '', length: bytes.length }];
  await invoke('export_write', bytes, {
    headers: { 'x-opennote-export': encodeURIComponent(JSON.stringify({ path, parts })) },
  });
  return true;
}

export async function exportDeck(deck: Deck, format: 'csv' | 'apkg'): Promise<void> {
  try {
    const name = fileName(deck.name, format);
    let saved: boolean;
    if (format === 'csv') {
      const { csv, skipped } = deckToCsv(deck);
      const bytes = new TextEncoder().encode(String.fromCharCode(0xfeff) + csv);
      saved = await saveBytes(name, t('study.io.csvLabel'), bytes, 'text/csv');
      if (saved && skipped > 0) announce(t('study.io.exportSkipped', { count: skipped }));
    } else {
      const { writeAnkiPackage } = await import('./anki');
      saved = await saveBytes(name, t('study.io.ankiLabel'), await writeAnkiPackage(deck), 'application/octet-stream');
    }
    if (saved) showToast({ message: t('study.io.exported', { name }) });
  } catch {
    showToast({ message: t('study.io.exportFailed'), tone: 'danger' });
  }
}
