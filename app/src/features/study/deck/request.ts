// A request to make cards from some text: the Flashcards window shows the candidates for review. The audio lane
// calls requestCards with a transcript's text, and the page commands call it with a page or a selection.
import { createStore } from '../../../state/store';
import { generateCards } from './generate';
import type { Candidate } from './generate';

export interface CardRequest {
  /** What the cards came from, such as the page's title. */
  source: string;
  candidates: Candidate[];
}

export const cardRequest = createStore<CardRequest | null>(null, 'study card request');

/** True when the palette asked for Import cards: the Flashcards window takes it and shows the import view. */
export const importWanted = createStore<boolean>(false, 'study import wanted');

/** Reads the text for cards and asks the Flashcards window to show what it found. */
export function requestCards(text: string, source: string): CardRequest {
  const request = { source, candidates: generateCards(text) };
  cardRequest.set(request);
  return request;
}

/**
 * The text "Make cards" on a transcript reads: the transcript and the text of the page it is on. Notes such as
 * "Term: meaning" lines are written on the page around the transcript, and the palette command reads them too.
 */
export function transcriptCardText(transcript: string, page: string | null): string {
  return page?.trim()
    ? `${page}

${transcript}`
    : transcript;
}
