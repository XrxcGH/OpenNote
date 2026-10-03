// Saving a deck as a file (Study tools): CSV or an Anki package. The browser's own save flow names the file.
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { deckToCsv } from '../deck/exchange';
import type { Deck } from '../deck/types';

/** A file name made from a deck's name. */
const BAD_CHARS = '\\/:*?"<>|';
const fileName = (name: string, extension: string): string => {
  const cleaned = [...name].map((char) => (char.charCodeAt(0) < 32 || BAD_CHARS.includes(char) ? ' ' : char));
  return `${cleaned.join('').trim().slice(0, 80) || 'deck'}.${extension}`;
};

/** Offers the bytes to the person as a download. */
export function downloadBytes(name: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportDeck(deck: Deck, format: 'csv' | 'apkg'): Promise<void> {
  try {
    const name = fileName(deck.name, format);
    if (format === 'csv') {
      const { csv, skipped } = deckToCsv(deck);
      downloadBytes(name, new TextEncoder().encode(String.fromCharCode(0xfeff) + csv), 'text/csv');
      if (skipped > 0) announce(t('study.io.exportSkipped', { count: skipped }));
    } else {
      const { writeAnkiPackage } = await import('./anki');
      downloadBytes(name, await writeAnkiPackage(deck), 'application/octet-stream');
    }
    showToast({ message: t('study.io.exported', { name }) });
  } catch {
    showToast({ message: t('study.io.exportFailed'), tone: 'danger' });
  }
}
