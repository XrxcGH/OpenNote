// Inline flashcards (Study tools): a line "Question :: Answer" is a card, and a line with {{words}} is a card with
// blanks. The cards belong to the page's deck, and a card's ID follows its place in the page, so editing the line
// edits the card and keeps its review history.
import type { Card } from './types';

const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const SEPARATOR = ' :: ';
const BLANK = /\{\{[^{}]+?\}\}/;

/** The text of a line without its list bullet, number, or checkbox. */
export const stripMarker = (line: string): string => line.replace(LIST_MARKER, '').trim();

/** What a line makes, or null when it makes no card. */
export function cardOfLine(line: string): Pick<Card, 'kind' | 'front' | 'back'> | null {
  const text = stripMarker(line);
  const at = text.indexOf(SEPARATOR);
  if (at > 0) {
    const front = text.slice(0, at).trim();
    const back = text.slice(at + SEPARATOR.length).trim();
    if (front && back) return { kind: 'basic', front, back };
  }
  if (BLANK.test(text)) return { kind: 'cloze', front: text, back: '' };
  return null;
}

/** The cards of a page's text blocks, in page order. A card's ID is its block and its line. */
export function inlineCards(blocks: readonly { id: string; markdown: string }[]): Card[] {
  const cards: Card[] = [];
  for (const block of blocks) {
    block.markdown.split('\n').forEach((line, index) => {
      const made = cardOfLine(line);
      if (made) cards.push({ id: `inline:${block.id}:${index}`, origin: `inline:${block.id}:${index}`, ...made });
    });
  }
  return cards;
}
