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

/** Reads the text for cards and asks the Flashcards window to show what it found. */
export function requestCards(text: string, source: string): CardRequest {
  const request = { source, candidates: generateCards(text) };
  cardRequest.set(request);
  return request;
}
