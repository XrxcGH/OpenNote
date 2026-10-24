// A word the page asks the dictionary to look up: "Look up the selected word" sets it, and the dictionary window shows
// it, whether the window was closed or already open. The counter makes a second request for the same word count.
import { createStore } from '../../../state/store';

export const wordRequest = createStore<{ word: string; count: number }>({ word: '', count: 0 }, 'dictionary request');

export function requestWord(word: string): void {
  wordRequest.set((current) => ({ word, count: current.count + 1 }));
}
