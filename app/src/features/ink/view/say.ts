// What a button on the page says when it finishes or cannot: a toast anyone can see, which the screen reader also
// speaks. A bare announcement is silent on the screen, so a button that only announced looked as if it did nothing.
// Every one shares a toast, so the newest replaces the last instead of waiting behind it: a queue of them replayed
// "Server added" while the person was already drawing a line (full walk 2, A1-A10-9).
import { showToast } from '../../../ui';

const SAY_TOAST = 'ink-say';

export function say(message: string): void {
  if (message) showToast({ id: SAY_TOAST, message });
}
