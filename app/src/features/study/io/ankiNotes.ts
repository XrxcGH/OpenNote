// Anki notes as cards (Study tools). The shell reads the package and hands over each note's fields as Anki wrote
// them, with HTML in them, and the pictures as data addresses. This turns them into cards of this app's kinds.
import { markupText } from '../../../core/markupText';
import { fromAnkiCloze } from '../deck/cloze';
import type { Skipped } from '../deck/exchange';
import { newId } from '../deck/library';
import type { Card } from '../deck/types';

export interface AnkiNote {
  fields: string[];
}

export interface AnkiRead {
  name: string;
  notes: AnkiNote[];
  /** Pictures by the file name the notes use, as data addresses. */
  media: Record<string, string>;
}

/** Plain text for a field's HTML, with line breaks kept. */
export function htmlToText(html: string): string {
  return markupText(html, { lines: true })
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The pictures a field names, found in the package's media. */
export function picturesOf(html: string, media: Readonly<Record<string, string>>): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi)) {
    const src = media[decodeURIComponent(match[1])];
    if (src) found.push(src);
  }
  return found;
}

export function notesToCards(read: AnkiRead): { cards: Card[]; skipped: Skipped[]; media: number } {
  const cards: Card[] = [];
  const skipped: Skipped[] = [];
  let pictures = 0;
  read.notes.forEach((note, index) => {
    const [first = '', second = ''] = note.fields;
    const cloze = /\{\{c\d+::/.test(first);
    const front = htmlToText(cloze ? fromAnkiCloze(first) : first);
    const back = htmlToText(second);
    const images = { front: picturesOf(first, read.media), back: picturesOf(second, read.media) };
    pictures += images.front.length + images.back.length;
    if (!front && images.front.length === 0) return void skipped.push({ line: index + 1, reason: 'empty' });
    if (!cloze && !back && images.back.length === 0) return void skipped.push({ line: index + 1, reason: 'noAnswer' });
    cards.push({
      id: newId('c'),
      kind: cloze ? 'cloze' : 'basic',
      front,
      back,
      origin: 'import',
      ...(images.front.length + images.back.length > 0 ? { images } : {}),
    });
  });
  return { cards, skipped, media: pictures };
}
