// Anki packages through the shell (Study tools): the shell opens the package (a zip with a SQLite collection) and
// writes new ones. In a browser without the shell there is no reader, so import and export say so.
import { dataUri } from '../deck/image';
import type { Deck } from '../deck/types';
import { notesToCards } from './ankiNotes';
import type { AnkiRead } from './ankiNotes';

async function shell() {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) throw new Error('shell');
  return import('@tauri-apps/api/core');
}

/** Reads a .apkg file. Rejects with the message 'newer' for a package in a format this app cannot read. */
export async function readAnkiPackage(bytes: Uint8Array) {
  const { invoke } = await shell();
  try {
    const read = await invoke<AnkiRead>('study_anki_read', bytes);
    return { ...notesToCards(read), name: read.name };
  } catch (error) {
    throw new Error(String((error as { code?: string })?.code ?? error).includes('newer') ? 'newer' : 'failed', {
      cause: error,
    });
  }
}

interface WireNote {
  id: string;
  cloze: boolean;
  front: string;
  back: string;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

/** The deck as an Anki package. Image cards go as two pictures: the question with its parts covered, and the answer. */
export async function writeAnkiPackage(deck: Deck): Promise<Uint8Array> {
  const { invoke } = await shell();
  const notes: WireNote[] = [];
  const media: { name: string; data: string }[] = [];
  for (const card of deck.cards) {
    if (card.kind === 'cloze') {
      let at = 0;
      const text = card.front.replace(
        /\{\{([^{}]+?)\}\}/g,
        (_all, word: string) => `{{c${(at += 1)}::${word.trim()}}}`,
      );
      notes.push({ id: card.id, cloze: true, front: escapeHtml(text), back: escapeHtml(card.back) });
    } else if (card.kind === 'choice') {
      const options = (card.choices ?? []).map((choice, index) => `${index + 1}. ${choice}`).join('\n');
      const right = card.choices?.[card.answer ?? 0] ?? '';
      notes.push({
        id: card.id,
        cloze: false,
        front: escapeHtml(`${card.front}\n${options}`),
        back: escapeHtml([right, card.back].filter(Boolean).join('\n')),
      });
    } else if (card.kind === 'occlusion' && card.image) {
      const { covered, original } = await dataUri.occluded(card.image);
      media.push({ name: `${card.id}-q.png`, data: covered }, { name: `${card.id}-a.png`, data: original });
      notes.push({
        id: card.id,
        cloze: false,
        front: `${escapeHtml(card.front)}<br><img src="${card.id}-q.png">`,
        back: `<img src="${card.id}-a.png">${card.back ? `<br>${escapeHtml(card.back)}` : ''}`,
      });
    } else notes.push({ id: card.id, cloze: false, front: escapeHtml(card.front), back: escapeHtml(card.back) });
  }
  const result = await invoke<ArrayBuffer>('study_anki_write', { deck: { name: deck.name, notes, media } });
  return new Uint8Array(result);
}
