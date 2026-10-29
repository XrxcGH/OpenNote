// What a button on the page says when it finishes or cannot: a toast anyone can see, which the screen reader also
// speaks. A bare announcement is silent on the screen, so a button that only announced looked as if it did nothing.
import { showToast } from '../../../ui';

export function say(message: string): void {
  if (message) showToast({ message });
}
